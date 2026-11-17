"""Shortme V3.5: small, executable, model-free reference algorithms.

NOT an independent highlight detector. These are pure functions for:
  - validating source PTS intervals,
  - provenance-preserving lane fusion,
  - clip candidate enumeration from supplied *measured* cut edges,
  - one-step revision of a bad clip using available edges,
  - diversified candidate selection.

The real Shortme app must provide actual audio, video, ASR, VLM observations,
judgement, playback and persistence. None are faked here.
"""
from __future__ import annotations

from dataclasses import dataclass
from math import isfinite
from typing import Iterable


@dataclass(frozen=True)
class Span:
    start: float
    end: float

    def __post_init__(self) -> None:
        if not (isfinite(self.start) and isfinite(self.end)):
            raise ValueError("Non-finite source PTS")
        if self.start < 0 or self.end <= self.start:
            raise ValueError("Invalid source interval")

    @property
    def duration(self) -> float:
        return self.end - self.start

    def contains(self, other: Span) -> bool:
        return self.start <= other.start and self.end >= other.end

    def overlap_ratio(self, other: Span) -> float:
        overlap = max(0.0, min(self.end, other.end) - max(self.start, other.start))
        union = max(self.end, other.end) - min(self.start, other.start)
        return overlap / union if union > 0 else 0.0


@dataclass(frozen=True)
class Seed:
    seed_id: str
    lane: str
    span: Span
    anchor_pts: float
    lane_rank: int
    event_hint: str
    evidence_ids: tuple[str, ...]

    def __post_init__(self) -> None:
        if not self.seed_id or not self.lane or self.lane_rank < 1:
            raise ValueError("Invalid seed identifier/rank")
        if not (self.span.start <= self.anchor_pts <= self.span.end):
            raise ValueError("Anchor out of bounds")
        if not self.evidence_ids:
            raise ValueError("Seed without real evidence is invalid")


@dataclass(frozen=True)
class EventGroup:
    source_seeds: tuple[Seed, ...]
    fused_rrf_score: float

    @property
    def lanes(self) -> frozenset[str]:
        return frozenset(x.lane for x in self.source_seeds)


@dataclass(frozen=True)
class CutEdge:
    edge_id: str
    pts: float
    kind: str
    evidence_ids: tuple[str, ...] = ()
    is_measured: bool = True

    def __post_init__(self) -> None:
        if not self.edge_id or not isfinite(self.pts) or self.pts < 0:
            raise ValueError("Invalid edge")
        if not self.is_measured and self.kind != "synthetic-offset":
            raise ValueError("Unmeasured boundary must be explicitly labeled")
        if self.is_measured and self.kind not in {"source-boundary", "manual"} and not self.evidence_ids:
            raise ValueError("Measured non-source edge needs evidence")


@dataclass(frozen=True)
class CutCandidate:
    candidate_id: str
    start_edge_id: str
    end_edge_id: str
    span: Span
    prefilter_score: float


def _same_event(a: Seed, b: Seed) -> bool:
    # Keep close but independent events separated. No blanket 60/90-sec gap.
    # Matching is intentionally conservative; app should apply a learned / human
    # event matcher to ambiguous cases instead of silently merging them.
    shared_evidence = bool(set(a.evidence_ids).intersection(b.evidence_ids))
    return a.event_hint == b.event_hint and (
        shared_evidence or (
            abs(a.anchor_pts - b.anchor_pts) <= 2.0
            and a.span.overlap_ratio(b.span) >= 0.55
        )
    )


def fuse_ranked_seeds(seeds: Iterable[Seed], k: float = 60.0) -> list[EventGroup]:
    """Conservative, deterministic fusion for independently retrieved seeds.

    Input is already per-lane ranked; RRF is *not* a probability. This routine
    neither performs media retrieval nor measures event semantic quality.
    """
    if not isfinite(k) or k <= 0:
        raise ValueError("k must be a positive finite number")
    ordered = sorted(seeds, key=lambda s: (s.anchor_pts, s.lane, s.seed_id))
    if len({s.seed_id for s in ordered}) != len(ordered):
        raise ValueError("seed IDs must be unique")
    groups: list[list[Seed]] = []
    for seed in ordered:
        matches = [i for i, group in enumerate(groups) if any(_same_event(seed, other) for other in group)]
        # Do not transitive-chain ambiguous neighbors into a huge fake event.
        if len(matches) == 1:
            groups[matches[0]].append(seed)
        else:
            groups.append([seed])
    results = []
    for group in groups:
        # Multiple queries from one lane cannot crowd out independent modalities.
        best_per_lane: dict[str, int] = {}
        for seed in group:
            best_per_lane[seed.lane] = min(best_per_lane.get(seed.lane, 10**9), seed.lane_rank)
        score = sum(1.0 / (k + rank) for rank in best_per_lane.values())
        results.append(EventGroup(tuple(group), score))
    return sorted(results, key=lambda g: (-g.fused_rrf_score, min(s.anchor_pts for s in g.source_seeds)))


def select_lane_balanced(groups: list[EventGroup], limit: int) -> list[EventGroup]:
    """Reserve one best group per nonempty lane, then fill by RRF.

    Production should additionally reserve time/genre buckets and hard budgets.
    """
    if limit < 0:
        raise ValueError("negative result limit")
    if not groups or limit == 0:
        return []
    lanes = sorted(set().union(*(g.lanes for g in groups)))
    picks: list[EventGroup] = []
    for lane in lanes:
        if len(picks) >= limit:
            break
        best = next((g for g in groups if lane in g.lanes and g not in picks), None)
        if best is not None:
            picks.append(best)
    picks.extend(g for g in groups if g not in picks)
    return picks[:limit]


def enumerate_cut_lattice(
    edges: Iterable[CutEdge],
    required: Span,
    source_duration: float,
    min_duration: float = 8.0,
    max_duration: float = 90.0,
    limit: int = 5,
) -> list[CutCandidate]:
    """Only produce cuts from supplied media edges covering required evidence.

    Scoring here is a cheap heuristic. A real AV/LLM quality judge must inspect
    the *rendered* clip before a clip can be called approved.
    """
    if not isfinite(source_duration) or source_duration <= 0 or required.end > source_duration:
        raise ValueError("Required interval outside source")
    if not (0 < min_duration <= max_duration <= source_duration) or limit < 1:
        raise ValueError("Invalid duration/limit")
    items = sorted(edges, key=lambda e: (e.pts, e.edge_id))
    if len(set(e.edge_id for e in items)) != len(items):
        raise ValueError("Duplicate edge IDs")
    if any(e.pts > source_duration for e in items):
        raise ValueError("Edge outside source")
    starts = [e for e in items if e.pts <= required.start]
    ends = [e for e in items if e.pts >= required.end]
    # Avoid exhaustive cross-product when full source contains tens of thousands of edges.
    starts = sorted(starts, key=lambda e: abs(e.pts - required.start))[:32]
    ends = sorted(ends, key=lambda e: abs(e.pts - required.end))[:32]
    scored: list[CutCandidate] = []
    preferred_kinds = {"sentence", "speech-pause", "pause", "shot", "audio-phrase", "action-transition", "action", "source-boundary"}
    for start in starts:
        for end in ends:
            duration = end.pts - start.pts
            if not min_duration <= duration <= max_duration:
                continue
            if duration <= 0:
                continue
            extra_duration = (required.start - start.pts) + (end.pts - required.end)
            # Source-PTS edge quality is only a deterministic prefilter.
            edge_bonus = 0.3 * int(start.kind in preferred_kinds) + 0.3 * int(end.kind in preferred_kinds)
            penalty = 1.0 if not start.is_measured or not end.is_measured else 0.0
            score = round(edge_bonus - 0.015 * extra_duration - penalty, 6)
            scored.append(CutCandidate(
                candidate_id=f"{start.edge_id}__{end.edge_id}",
                start_edge_id=start.edge_id,
                end_edge_id=end.edge_id,
                span=Span(start.pts, end.pts),
                prefilter_score=score,
            ))
    scored.sort(key=lambda c: (-c.prefilter_score, c.span.duration, c.candidate_id))
    return scored[:limit]


def choose_single_repair(
    current: CutCandidate,
    alternatives: Iterable[CutCandidate],
    failure: str,
) -> CutCandidate | None:
    """One defensible repair, avoiding fabricated edge/timestamp offsets.

    Production rerenders and reevaluates the returned candidate, with an audit
    trail. This helper intentionally never declares the revised clip 'good'.
    """
    available = [a for a in alternatives if a.candidate_id != current.candidate_id]
    if failure in {"missing_context", "starts_mid_sentence", "missing_referent"}:
        valid = [x for x in available if x.span.start < current.span.start and x.span.end == current.span.end]
        valid.sort(key=lambda x: (current.span.start - x.span.start, -x.prefilter_score))
    elif failure in {"payoff_cut", "reaction_cut", "ending_unnatural"}:
        valid = [x for x in available if x.span.end > current.span.end and x.span.start == current.span.start]
        valid.sort(key=lambda x: (x.span.end - current.span.end, -x.prefilter_score))
    else:
        return None  # caption/crop/audio seam needs a distinct repair path
    return valid[0] if valid else None
