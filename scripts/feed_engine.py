"""Prompt-driven content discovery and ranking for YouTube Guide.

Independent channel profiles; optionally uses local ONNX embedding model through
FastEmbed. Works without third-party packages at reduced relevance quality.
No YouTube private API endpoints and no scraped watch-history data.
"""
from __future__ import annotations
from collections import Counter
from functools import lru_cache
import math
import os
import re

STOP = set('a an and are as at be but by can channel channels create do for from give have i in into is it just like make me more my new of on or our please recommend recommendations show similar some that the their them these this to us video videos want watch with would youtube your you'.split())
SEARCH_STOP = STOP | set('all best clips episode episodes explained history lets most official part reaction reactions review reviews shorts theory top watch full compilation 2020 2021 2022 2023 2024 2025 2026 video essay retrospective explained theory'.split())
BAD_TITLE = ('#shorts', 'youtube shorts', 'livestream', 'live stream', 'trailer', 'full movie')


def words(value):
    return [w for w in re.findall(r'[a-z0-9]+', str(value or '').lower()) if (len(w) >= 3 or w.isdigit()) and w not in STOP]


def keywords(value):
    return [w for w in words(value) if w not in SEARCH_STOP]


def clean_prompt(prompt):
    s = str(prompt or '').strip()
    s = re.sub(r'^\s*(?:make|create|build|give me|i want|show me|find me|recommend|videos? about|a feed (?:of|about|for))\s+', '', s, flags=re.I)
    s = re.sub(r'^\s*(?:a|an|my|the|youtube|channel|feed|videos?|about|on|of|for|focused on|covering)\s+', '', s, flags=re.I)
    s = re.split(r'\b(?:without|exclude|avoid|but not|rather than)\b', s, maxsplit=1, flags=re.I)[0]
    return s.strip(' .,:;-')


def negatives(prompt, exclude):
    explicit = re.split(r'[,;\n]+', str(exclude or ''))
    embedded = re.findall(r'\b(?:without|exclude|avoid|but not)\s+([^.;\n]+)', str(prompt or ''), flags=re.I)
    explicit += [p for t in embedded for p in re.split(r',|\band\b', t)]
    def negative_words(x): return [w for w in words(x) if w not in ('and','with','that','without')]
    return [tuple(negative_words(x)) for x in explicit if negative_words(x)]


def seed_topics(seeds):
    title_counts = Counter()
    phrases = Counter()
    for item in seeds[:60]:
        w = keywords(item.get('title'))
        title_counts.update(set(w))
        for pair in set(zip(w, w[1:])):
            phrases[' '.join(pair)] += 1
    pairs = [p for p, n in phrases.most_common() if n >= 2]
    terms = [p for p, n in title_counts.most_common(12) if n >= 2]
    return pairs[:5], terms[:10]


def query_plan(prompt, seeds):
    """Rotate concrete subjects, not generic 'analysis' in every query."""
    explicit = clean_prompt(prompt)
    parts = []
    if explicit:
        pieces = re.split(r'[,;]|\b(?:especially|including|featuring|and also)\b', explicit, flags=re.I)
        parts.extend(' '.join(keywords(p)[:8]) for p in pieces if keywords(p))
        # Whole descriptive prompt is useful when concise.
        if len(keywords(explicit)) <= 8:
            parts.insert(0, ' '.join(keywords(explicit)))
    pairs, terms = seed_topics(seeds)
    parts.extend(pairs[:4])
    # Augment the user's main topic with terms from examples, if available.
    main = parts[0] if parts else ''
    if main:
        parts.extend(main + ' ' + term for term in terms[:6] if term not in main.split())
    elif terms:
        parts.append(' '.join(terms[:3]))
    if not parts and seeds:
        parts = [' '.join(keywords(s.get('title'))[:5]) for s in seeds[:8]]
    # Explore adjacent angles instead of searching the same string forever.
    if main:
        parts.extend([main+' explained', main+' discussion', main+' documentary', main+' retrospective'])
    uniq = []
    for p in parts:
        p = ' '.join(p.split()).strip()
        if 2 <= len(p) <= 85 and p not in uniq:
            uniq.append(p)
    return uniq[:18]


def content(v):
    return ' '.join([str(v.get('title') or '')]*2 + [str(v.get('description') or '')[:520],
                     ' '.join(map(str, v.get('tags') or []))[:200]])[:1100]


def cosine(a, b):
    aa = sum(x*x for x in a); bb = sum(x*x for x in b)
    return sum(x*y for x, y in zip(a,b)) / math.sqrt(aa*bb) if aa and bb else 0.0


def lexical_score(v, prompt, seeds):
    """Ranking fallback and sanity check, never merely shared arbitrary words."""
    text = content(v)
    tw = set(keywords(v.get('title')))
    sw = set(keywords(text))
    requested = set(keywords(clean_prompt(prompt)))
    overlap = len(requested & tw) / len(requested) if requested else 0.0
    supplemental = len(requested & sw) / len(requested) if requested else 0.0
    scores = []
    for s in seeds[:40]:
        a = set(keywords(s.get('title')))
        if not a: continue
        scores.append(2*len(a & tw)/(len(a)+len(tw) or 1))
    scores.sort(reverse=True)
    match = sum(scores[:4])/len(scores[:4]) if scores else 0.0
    return 0.46*overlap + 0.18*supplemental + 0.36*match


def allowed(v, channel, seeds):
    title = str(v.get('title') or '').lower()
    if any(t in title for t in BAD_TITLE) and not any(t in str(channel.get('feedPrompt') or '').lower() for t in BAD_TITLE):
        return False
    if v.get('id') in set(channel.get('rejectedIds') or []):
        return False
    blocked = negatives(channel.get('feedPrompt') or '', channel.get('seedExclude') or '')
    txt = ' '.join(words(content(v)))
    for phrase in blocked:
        if phrase and all(re.search(r'\b'+re.escape(w)+r'\b', txt) for w in phrase):
            return False
    # For strongly focused subjects (e.g. "Ben 10") require subject evidence
    # in the returned metadata; semantic-only relatedness can drift badly.
    prompt = clean_prompt(channel.get('feedPrompt') or '')
    main = set(keywords(re.split(r'[,;]|\b(?:especially|including|featuring)\b',prompt,maxsplit=1,flags=re.I)[0]))
    if 0 < len(main) <= 3 and not seeds:
        seen = set(keywords(content(v)))
        if not main & seen:
            return False
        numbers = {w for w in main if w.isdigit()}
        if numbers and not numbers.issubset(seen):
            return False
        if numbers and not (main - numbers).intersection(seen):
            return False
    return True


@lru_cache(maxsize=1)
def model():
    if os.environ.get('FEED_EMBEDDINGS','1') == '0':
        return None
    try:
        from fastembed import TextEmbedding
        return TextEmbedding(model_name='BAAI/bge-small-en-v1.5')
    except Exception as e:
        print('Semantic model unavailable, using stricter lexical ranking:', e)
        return None


def embed_scores(prompt, seeds, videos):
    m = model()
    if m is None: return None
    reference = [clean_prompt(prompt)] if clean_prompt(prompt) else []
    reference += [content(v) for v in seeds[:16]]
    if not reference:
        return None
    passages = [content(v) for v in videos]
    try:
        arrays = list(m.embed(reference + passages, batch_size=16))
    except Exception as e:
        print('Embedding inference failed; using lexical ranking:',e)
        return None
    ref = arrays[:len(reference)]
    doc = arrays[len(reference):]
    scores = []
    for vec in doc:
        prompt_match = cosine(ref[0],vec) if prompt else 0.0
        sem = sorted((cosine(r,vec) for r in ref[1:] if seeds), reverse=True)
        seed_match = sum(sem[:4])/len(sem[:4]) if sem else 0.0
        if prompt and seeds: score = 0.65*prompt_match + 0.35*seed_match
        else: score = prompt_match if prompt else seed_match
        scores.append(score)
    return scores


def rank(channel, seeds, videos, limit=35, use_model=True):
    """Filter, rerank and diversify. Never promises perfect feed equivalence."""
    prompt = str(channel.get('feedPrompt') or '')
    candidates = [v for v in videos if allowed(v,channel,seeds)]
    if not candidates: return []
    lexical = [lexical_score(v,prompt,seeds) for v in candidates]
    semantic = embed_scores(prompt,seeds,candidates) if use_model else None
    scored = []
    for idx, v in enumerate(candidates):
        lex=lexical[idx]
        if semantic is None:
            # Without actual embeddings, enforce a stronger lexical overlap threshold.
            if lex < (0.15 if channel.get('seedStrictness')=='balanced' else 0.24): continue
            score = lex
        else:
            sem=semantic[idx]
            # Semantic similarity alone is insufficient when a video clearly diverges.
            if sem < (0.43 if channel.get('seedStrictness')=='balanced' else 0.49):continue
            score = 0.8*sem + 0.2*lex
        scored.append((score,v))
    scored.sort(key=lambda pair:(-pair[0],pair[1].get('id','')))
    # Enforce creator variety, but permit more than one creator video.
    chosen=[];creator_counts=Counter()
    for score,v in scored:
        cid=v.get('creatorId') or v.get('creator') or v.get('id')
        if creator_counts[cid]>=max(3,limit//8):continue
        chosen.append({**v,'fit':round(score*100)})
        creator_counts[cid]+=1
        if len(chosen)>=limit:break
    return chosen
