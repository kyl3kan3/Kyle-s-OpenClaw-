/**
 * Chunker — splits memory files into overlapping chunks for indexing.
 *
 * Uses a sliding window with overlap preservation, matching OpenClaw's
 * approach but with smarter boundary detection (prefers splitting at
 * paragraph/sentence boundaries over arbitrary character cuts).
 */

export interface Chunk {
  content: string;
  index: number;
  startOffset: number;
  endOffset: number;
  source: string;
}

export class Chunker {
  private chunkSize: number;
  private overlap: number;

  constructor(chunkSize = 700, overlap = 100) {
    this.chunkSize = chunkSize;
    this.overlap = overlap;
  }

  /**
   * Split text into overlapping chunks with smart boundaries.
   */
  chunk(text: string, source: string): Chunk[] {
    if (text.length <= this.chunkSize) {
      return [
        {
          content: text,
          index: 0,
          startOffset: 0,
          endOffset: text.length,
          source,
        },
      ];
    }

    const chunks: Chunk[] = [];
    let position = 0;
    let index = 0;

    while (position < text.length) {
      let end = Math.min(position + this.chunkSize, text.length);

      // Try to find a natural boundary near the end
      if (end < text.length) {
        end = this.findBoundary(text, end);
      }

      chunks.push({
        content: text.slice(position, end),
        index,
        startOffset: position,
        endOffset: end,
        source,
      });

      // Move forward by chunkSize minus overlap
      position = end - this.overlap;
      if (position >= text.length) break;
      // Avoid creating tiny final chunks
      if (text.length - position < this.overlap) break;
      index++;
    }

    return chunks;
  }

  /**
   * Find a natural boundary (paragraph > sentence > word) near the target position.
   */
  private findBoundary(text: string, target: number): number {
    const searchWindow = Math.min(100, this.chunkSize / 4);
    const start = Math.max(0, target - searchWindow);
    const end = Math.min(text.length, target + searchWindow / 2);
    const window = text.slice(start, end);

    // Prefer paragraph boundary (\n\n)
    const paraBreak = window.lastIndexOf("\n\n");
    if (paraBreak !== -1 && paraBreak > searchWindow / 2) {
      return start + paraBreak + 2;
    }

    // Then sentence boundary (. or ! or ?)
    const sentenceMatch = window.match(/[.!?]\s/g);
    if (sentenceMatch) {
      const lastSentence = window.lastIndexOf(
        sentenceMatch[sentenceMatch.length - 1]
      );
      if (lastSentence > searchWindow / 2) {
        return start + lastSentence + 2;
      }
    }

    // Then word boundary
    const lastSpace = window.lastIndexOf(" ");
    if (lastSpace !== -1) {
      return start + lastSpace + 1;
    }

    return target;
  }
}
