// Versionen der neuen Engine: gehen in den Eingabefingerabdruck ein. Ändert sich ein Prompt, ein Modell oder der Algorithmus, passt ein altes Ergebnis nicht mehr.
export const V2_PROMPT_REVISION = 'prompts-v2.2'
export const V2_ALGORITHM_REVISION = 'algo-2.1'
/** Modell-IDs der Pflichtrollen (Katalog); werden beim Anbinden der Modelle gesetzt. */
export const V2_MODELS = { vision: 'qwen3-vl-4b', audio: 'voxtral-mini-3b', audioEvents: 'yamnet' } as const

export const v2Revisions = (): string[] => [V2_PROMPT_REVISION, V2_ALGORITHM_REVISION, ...Object.values(V2_MODELS)]
