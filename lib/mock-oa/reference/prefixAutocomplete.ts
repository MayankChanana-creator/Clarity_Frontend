/**
 * Reference solution for P2: Prefix Autocomplete
 * Topic: tries, strings, sorting
 *
 * Input format:
 * n
 * word1 score1
 * word2 score2
 * ...
 * wordn scoren
 * q
 * query1
 * query2
 * ...
 * queryq
 *
 * Output:
 * q lines. For each query, up to 3 highest-scoring words with that prefix,
 * ties broken lexicographically ascending, space-separated, or "-" if none.
 */

interface ScoredWord {
  word: string;
  score: number;
}

class TrieNode {
  children: Map<string, TrieNode> = new Map();
  topWords: ScoredWord[] = [];
}

function compareWords(a: ScoredWord, b: ScoredWord): number {
  if (a.score !== b.score) {
    return b.score - a.score; // Higher score first
  }
  return a.word.localeCompare(b.word); // Lexicographical tie-breaker
}

export function solvePrefixAutocomplete(input: string): string {
  const lines = input.trim().split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return '';

  let lineIdx = 0;
  const n = parseInt(lines[lineIdx++], 10);

  const wordList: ScoredWord[] = [];
  for (let i = 0; i < n; i++) {
    const parts = lines[lineIdx++].split(/\s+/);
    const word = parts[0];
    const score = parseInt(parts[1], 10);
    wordList.push({ word, score });
  }

  // Sort all words once by score desc, word asc
  wordList.sort(compareWords);

  const root = new TrieNode();

  for (const item of wordList) {
    let curr = root;
    if (curr.topWords.length < 3) {
      curr.topWords.push(item);
    }
    for (const ch of item.word) {
      if (!curr.children.has(ch)) {
        curr.children.set(ch, new TrieNode());
      }
      curr = curr.children.get(ch)!;
      if (curr.topWords.length < 3) {
        curr.topWords.push(item);
      }
    }
  }

  const q = parseInt(lines[lineIdx++], 10);
  const results: string[] = [];

  for (let i = 0; i < q; i++) {
    const prefix = lines[lineIdx++] || '';
    let curr: TrieNode | undefined = root;
    for (const ch of prefix) {
      if (!curr) break;
      curr = curr.children.get(ch);
    }

    if (!curr || curr.topWords.length === 0) {
      results.push('-');
    } else {
      results.push(curr.topWords.map((w) => w.word).join(' '));
    }
  }

  return results.join('\n');
}
