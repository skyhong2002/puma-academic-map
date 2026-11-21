self.onmessage = async ({ data: challenge }) => {
  const encoder = new TextEncoder();
  const batchSize = 64;
  for (let start = 0; start < 0x1_0000_0000; start += batchSize) {
    const answers = Array.from({ length: batchSize }, (_, index) => (start + index).toString(16));
    const hashes = await Promise.all(answers.map((answer) =>
      crypto.subtle.digest('SHA-256', encoder.encode(`${challenge}:${answer}`))));
    const match = hashes.findIndex((hash) => new DataView(hash).getUint16(0) === 0);
    if (match !== -1) {
      self.postMessage(answers[match]);
      return;
    }
  }
  throw new Error('No proof found');
};
