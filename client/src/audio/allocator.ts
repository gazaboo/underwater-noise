/**
 * Attribution des voix (polyphonie limitée) avec hystérésis : les candidats les plus forts
 * obtiennent une voix ; un nouveau venu ne prend la place d'une voix existante que s'il la dépasse
 * de `hysteresisDb`. Évite la « valse » des voix quand des navires de niveaux proches se croisent.
 */
export interface Candidate {
  id: number;
  score: number; // dB
}

export function allocate(active: ReadonlySet<number>, candidates: readonly Candidate[], voices: number, hysteresisDb: number): Set<number> {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  // On garde les voix actives toujours candidates.
  const kept = [...active].filter((id) => byId.has(id)).map((id) => byId.get(id)!);
  kept.sort((a, b) => b.score - a.score);
  const result = kept.slice(0, voices);
  const inResult = new Set(result.map((c) => c.id));
  for (const c of sorted) {
    if (inResult.has(c.id)) continue;
    if (result.length < voices) {
      result.push(c);
      inResult.add(c.id);
      continue;
    }
    // Remplacement de la voix la plus faible si le nouveau venu la dépasse nettement.
    let weakest = 0;
    for (let i = 1; i < result.length; i++) if (result[i].score < result[weakest].score) weakest = i;
    if (result.length && c.score > result[weakest].score + hysteresisDb) {
      inResult.delete(result[weakest].id);
      result[weakest] = c;
      inResult.add(c.id);
    } else {
      break; // les suivants sont plus faibles encore
    }
  }
  return inResult;
}
