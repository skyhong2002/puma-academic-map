export function commentVerification(loadChallenge) {
  const row = document.createElement('div');
  row.className = 'person-comments__verification';
  const label = document.createElement('label');
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  label.append(checkbox, '我不是機器人');
  const status = document.createElement('span');
  status.setAttribute('role', 'status');
  row.append(label, status);

  let proof;
  let cancelVerification;
  function reset(message = '') {
    cancelVerification?.abort();
    cancelVerification = undefined;
    proof = undefined;
    checkbox.checked = false;
    status.textContent = message;
  }

  checkbox.addEventListener('change', async () => {
    if (!checkbox.checked) {
      reset();
      return;
    }
    const controller = new AbortController();
    cancelVerification = controller;
    status.textContent = '驗證中…';
    try {
      const { challenge } = await loadChallenge(controller.signal);
      controller.signal.throwIfAborted();
      const worker = new Worker(new URL('./comment-proof-worker.js', import.meta.url), { type: 'module' });
      let answer;
      try {
        answer = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error()), 45_000);
          const finish = (callback, value) => {
            clearTimeout(timeout);
            controller.signal.removeEventListener('abort', abort);
            callback(value);
          };
          const abort = () => finish(reject, controller.signal.reason);
          controller.signal.addEventListener('abort', abort, { once: true });
          worker.onmessage = (event) => finish(resolve, event.data);
          worker.onerror = () => finish(reject, new Error());
          worker.postMessage(challenge);
        });
      } finally {
        worker.terminate();
      }
      if (controller.signal.aborted) return;
      proof = { challenge, answer };
      status.textContent = '驗證完成';
    } catch {
      if (!controller.signal.aborted) reset('驗證未完成，請重新勾選。');
    }
  });

  return { row, checkbox, getProof: () => proof, reset };
}
