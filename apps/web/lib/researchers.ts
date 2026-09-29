/**
 * Shared definitions of the Researchers page. Pure — no database, no I/O — so
 * the client view imports it as well as the server pipeline.
 */

export type DirectionFamily = "inference" | "agents" | "infrastructure" | "generation" | "security" | "other";

export type ResearchDirection = {
  id: string;
  labelZh: string;
  labelEn: string;
  /** Related directions share a colour family; the digest counts every family of two or more directions. */
  family: DirectionFamily;
  color: string;
  /** Background of a [[id|…]] highlight in the hot-topics text. */
  tint: string;
  /** What the classifier reads; English like every prompt. */
  definition: string;
};

export const OTHER_DIRECTION_ID = "other";

/**
 * The fixed directions, and the only copy of them: PaperDirection.directionId
 * stores these ids as plain strings. A colour is bound to its id and never
 * reused, so a person's colour bar stays comparable between updates; related
 * directions share a hue at different depths. "other" stays last.
 */
export const DIRECTIONS: readonly ResearchDirection[] = [
  { id: "llm-serving", family: "inference", labelZh: "LLM 推理服务", labelEn: "LLM serving", color: "#4f9484", tint: "rgba(79,148,132,.18)",
    definition: "Serving LLM inference: scheduling and batching, KV cache management, compression and eviction, speculative decoding, long-context serving, multi-tenant isolation, and characterizations of LLM or agent request workloads." },
  { id: "agents-for-systems", family: "agents", labelZh: "用 agent 做系统研究", labelEn: "Agents for systems", color: "#4f7fa6", tint: "rgba(79,127,166,.17)",
    definition: "Using LLM agents to do systems work: generating GPU kernels or communication code, compiler-agent co-design, performance reasoning, agents that design hardware or build operating systems, and benchmarks or verification of such agents." },
  { id: "gpu-cluster", family: "infrastructure", labelZh: "GPU 与集群底层", labelEn: "GPU & cluster infrastructure", color: "#c9976b", tint: "rgba(201,151,107,.24)",
    definition: "GPU and cluster infrastructure for AI: collective communication, fused multi-GPU kernels, GPU memory sharing, interconnects and topology, RL training infrastructure (weight sync, rollout and trainer pipelines), and GPU data processing." },
  { id: "agent-harness", family: "agents", labelZh: "Agent harness 与上下文", labelEn: "Agent harness & context", color: "#9dbbd6", tint: "rgba(157,187,214,.34)",
    definition: "Making agents themselves better without changing model weights: harness design and self-improvement, context and memory management for long-horizon agents, trace analysis, verifiers, and multi-agent coordination." },
  { id: "moe-disaggregation", family: "inference", labelZh: "MoE 与解耦推理", labelEn: "MoE & disaggregated inference", color: "#8cc0b2", tint: "rgba(140,192,178,.3)",
    definition: "Mixture-of-experts serving and disaggregated inference: prefill/decode separation, operator- or expert-level disaggregation, placement across heterogeneous hardware, and MoE serving on edge devices." },
  { id: "diffusion-video", family: "generation", labelZh: "扩散模型与视频生成", labelEn: "Diffusion & video generation", color: "#a293c6", tint: "rgba(162,147,198,.24)",
    definition: "Systems for diffusion models and video generation: serving diffusion language models, denoising caches, efficient training or post-training of diffusion models, and streaming generation." },
  { id: "quantization", family: "inference", labelZh: "量化与高效推理", labelEn: "Quantization & efficient inference", color: "#c2ddd5", tint: "rgba(194,221,213,.5)",
    definition: "Quantization and model-side efficiency: low-bit weights or attention, rounding algorithms, and accuracy-efficiency trade-offs of reasoning models." },
  { id: "ai-security", family: "security", labelZh: "AI 安全", labelEn: "AI security", color: "#9aa5b3", tint: "rgba(154,165,179,.26)",
    definition: "Security of AI systems and AI for security: agent-driven vulnerability discovery, proofs of exploitability, and attacks on inference stacks." },
  { id: OTHER_DIRECTION_ID, family: "other", labelZh: "其他", labelEn: "Other", color: "#d0d6de", tint: "rgba(208,214,222,.35)",
    definition: "Anything not covered by the directions above." }
];

export const DIRECTION_IDS: ReadonlySet<string> = new Set(DIRECTIONS.map((d) => d.id));

/** `language` is a UI locale ("zh-CN") or an output language ("zh" | "en"). */
export function directionLabel(direction: Pick<ResearchDirection, "labelZh" | "labelEn">, language: string): string {
  return language.startsWith("zh") ? direction.labelZh : direction.labelEn;
}

/**
 * Papers and distinct tracked researchers in a set of papers: the figures the
 * direction chips show and the only per-direction figures the monthly issue
 * may cite, so both count the same way.
 */
export function tally(papers: readonly { researchers: readonly { slug: string }[] }[]): { papers: number; people: number } {
  return { papers: papers.length, people: new Set(papers.flatMap((p) => p.researchers.map((r) => r.slug))).size };
}

export const DAY_MS = 86_400_000;
/** "The last 3 months": the page and the issue cover the same 91 UTC days. */
export const WINDOW_DAYS = 91;
export const WINDOW_MONTHS = 3;
/** Papers this recent get the NEW badge and the timeline's shaded band. */
export const NEW_DAYS = 14;

/** A day as YYYY-MM-DD, the form the feed and the page carry dates in. */
export const isoDay = (date: Date): string => date.toISOString().slice(0, 10);

/** Midnight UTC of a YYYY-MM-DD day. */
export const fromIsoDay = (day: string): Date => new Date(`${day}T00:00:00Z`);

export function utcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function windowStart(now: Date): Date {
  return new Date(utcDay(now).getTime() - WINDOW_DAYS * DAY_MS);
}

export function newSince(now: Date): Date {
  return new Date(utcDay(now).getTime() - NEW_DAYS * DAY_MS);
}

/** An issue's key: the 1st of its month, UTC. */
export function monthKey(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Length limits of the monthly issue. A CJK character or a Latin word counts
 * one unit, so "按 agent 设计" is not inflated by the letters of "agent".
 * English limits are the Chinese ones × 0.6, rounded (an English word carries
 * about 1.7 characters of Chinese).
 */
export const DIGEST_LIMITS = {
  zh: { headline: 30, lede: 80, claim: 20, evidence: 50, unit: "units (one CJK character or one Latin word each)" },
  en: { headline: 18, lede: 48, claim: 12, evidence: 30, unit: "words" }
} as const;
