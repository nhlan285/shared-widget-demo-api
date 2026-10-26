// Cloudflare bindings for the current Worker isolate. Express handlers do not
// receive `env`, so worker.mjs stores it here before routing each request.
let bindings = null;

const setBindings = (env) => {
  bindings = env;
};

const binding = (name) => {
  if (!bindings || !bindings[name]) {
    throw new Error(`Missing Cloudflare binding: ${name}`);
  }
  return bindings[name];
};

// Binding không bắt buộc (biến môi trường tuỳ chọn): trả undefined khi chưa đặt
const optionalBinding = (name) => (bindings ? bindings[name] : undefined);

module.exports = {
  setBindings,
  binding,
  optionalBinding,
  db: () => binding("DB"),
  bucket: () => binding("FILES"),
};
