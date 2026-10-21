const coreModuleUrl = "/wasm/luora_z_core.js";

try {
  const coreModule = await import(coreModuleUrl);
  await coreModule.default();
  window.__luoraZCore = { status: "ready", core: coreModule };
} catch (error) {
  window.__luoraZCore = { status: "error", message: String(error && error.message ? error.message : error) };
}

window.dispatchEvent(new Event("luora-z-core"));
