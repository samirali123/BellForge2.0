// preload.js — the only bridge between the renderer (untrusted web content)
// and the main process (full Node access). Exposes a narrow, named API
// instead of giving the renderer direct access to ipcRenderer/Node.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  listSchools: () => ipcRenderer.invoke("list-schools"),
  getTheme: () => ipcRenderer.invoke("get-theme"),
  setTheme: (theme) => ipcRenderer.invoke("set-theme", { theme }),
  checkReachable: (schoolId) => ipcRenderer.invoke("check-reachable", { schoolId }),
  connect: (schoolId) => ipcRenderer.invoke("connect", { schoolId }),
  getScheduleMenu: () => ipcRenderer.invoke("get-schedule-menu"),
  createEvents: (assignments) => ipcRenderer.invoke("create-events", { assignments }),
  validateBlock: (block) => ipcRenderer.invoke("validate-block", { block }),
  previewSchedule: (label, blocks) => ipcRenderer.invoke("preview-schedule", { label, blocks }),
  saveSchedule: (label, blocks) => ipcRenderer.invoke("save-schedule", { label, blocks }),
  deleteSchedule: (key) => ipcRenderer.invoke("delete-schedule", { key }),
  importScheduleCsv: () => ipcRenderer.invoke("import-schedule-csv"),
  saveCsvTemplate: () => ipcRenderer.invoke("save-csv-template"),
  readMonth: (year, month) => ipcRenderer.invoke("read-month", { year, month }),
  deleteBells: (bells) => ipcRenderer.invoke("delete-events", { bells }),
  fitCalendar: () => ipcRenderer.invoke("fit-calendar"),
  onDeleteProgress: (callback) => {
    const listener = (event, progress) => callback(progress);
    ipcRenderer.on("delete-progress", listener);
    return () => ipcRenderer.removeListener("delete-progress", listener);
  },

  onStatus: (callback) => {
    const listener = (event, text) => callback(text);
    ipcRenderer.on("status-update", listener);
    return () => ipcRenderer.removeListener("status-update", listener);
  },
  onCreateProgress: (callback) => {
    const listener = (event, progress) => callback(progress);
    ipcRenderer.on("create-progress", listener);
    return () => ipcRenderer.removeListener("create-progress", listener);
  },
});
