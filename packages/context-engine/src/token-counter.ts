/**
 * Token estimation.
 * Uses a fast heuristic (~4 chars per token for English)
 * with optional integration for tiktoken or model-specific tokenizers.
 */

export class TokenCounter {
  private charsPerToken: number;

  constructor(charsPerToken = 4) {
    this.charsPerToken = charsPerToken;
  }

  count(text: string): number {
    return Math.ceil(text.length / this.charsPerToken);
  }

  countMessages(messages: Array<{ content: string; role: string }>): number {
    let total = 0;
    for (const msg of messages) {
      // ~4 tokens overhead per message for role, separators
      total += this.count(msg.content) + 4;
    }
    return total;
  }
}
