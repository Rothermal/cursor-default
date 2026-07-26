export function careerSportOptions(
  legacySports: string[],
  teamSports: string[],
  requestedSport: string | null
): string[] {
  const options = new Set([...legacySports, ...teamSports])
  if (requestedSport) options.add(requestedSport)
  return [...options].sort()
}
