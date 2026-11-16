"use strict";
window.rpc = async (method, args = {}) => {
  const response = await window.webkit.messageHandlers.simaq.postMessage({method, args});
  if (!response.ok) throw new Error(response.error || "操作失败");
  return response.value;
};
window.assetURL = path => "simaq-asset://workspace/" + String(path).split("/").map(encodeURIComponent).join("/");
