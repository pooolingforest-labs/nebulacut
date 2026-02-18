const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("nebulacut", {
  runtime: "electron",
});
