/**
 * Reference solution for P1: Balanced Shipments
 * Topic: binary-search on answer, arrays
 *
 * Input format:
 * n D
 * w1 w2 ... wn
 *
 * Output:
 * One integer representing minimum maximum shipment capacity per day.
 */

export function solveBalancedShipments(input: string): string {
  const tokens = input.trim().split(/\s+/);
  if (tokens.length < 2 || tokens[0] === '') return '0';

  const n = parseInt(tokens[0], 10);
  const d = parseInt(tokens[1], 10);

  const weights: bigint[] = [];
  let maxWeight = 0n;
  let totalWeight = 0n;

  for (let i = 0; i < n; i++) {
    const w = BigInt(tokens[2 + i]);
    weights.push(w);
    if (w > maxWeight) maxWeight = w;
    totalWeight += w;
  }

  function canShip(capacity: bigint): boolean {
    let daysNeeded = 1;
    let currentDayLoad = 0n;

    for (const w of weights) {
      if (currentDayLoad + w > capacity) {
        daysNeeded++;
        currentDayLoad = w;
      } else {
        currentDayLoad += w;
      }
    }

    return daysNeeded <= d;
  }

  let low = maxWeight;
  let high = totalWeight;
  let answer = totalWeight;

  while (low <= high) {
    const mid = (low + high) / 2n;
    if (canShip(mid)) {
      answer = mid;
      high = mid - 1n;
    } else {
      low = mid + 1n;
    }
  }

  return answer.toString();
}
