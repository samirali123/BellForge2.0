// preload.js — the only bridge between the renderer (untrusted web content)
// and the main process (full Node access). Exposes a narrow, named API
// instead of giving the renderer direct access to ipcRenderer/Node.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  listSchools: () => ipcRenderer.invoke("list-schools"),
  getTheme: () => ipcRenderer.invoke("get-theme"),
  getLastSchool: () => ipcRenderer.invoke("get-last-school"),
  forgetLastSchool: () => ipcRenderer.invoke("forget-last-school"),
  setTheme: (theme) => ipcRenderer.invoke("set-theme", { theme }),
  checkReachable: (schoolId) => ipcRenderer.invoke("check-reachable", { schoolId }),
  connect: (schoolId) => ipcRenderer.invoke("connect", { schoolId }),
  getScheduleMenu: () => ipcRenderer.invoke("get-schedule-menu"),
  validateBlock: (block) => ipcRenderer.invoke("validate-block", { block }),
  previewSchedule: (label, blocks) => ipcRenderer.invoke("preview-schedule", { label, blocks }),
  saveSchedule: (label, blocks) => ipcRenderer.invoke("save-schedule", { label, blocks }),
  deleteSchedule: (key) => ipcRenderer.invoke("delete-schedule", { key }),
  importScheduleCsv: () => ipcRenderer.invoke("import-schedule-csv"),
  saveCsvTemplate: () => ipcRenderer.invoke("save-csv-template"),
  readMonth: (year, month) => ipcRenderer.invoke("read-month", { year, month }),
  // Who's using BellForge, and the activity log.
  getAccounts: () => ipcRenderer.invoke("get-accounts"),
  createAccount: (name, note) => ipcRenderer.invoke("create-account", { name, note }),
  setUser: (id) => ipcRenderer.invoke("set-user", { id }),
  readActivity: (filters) => ipcRenderer.invoke("read-activity", filters),
  exportActivity: (filters) => ipcRenderer.invoke("export-activity", filters),
  onWarning: (callback) => {
    const listener = (event, text) => callback(text);
    ipcRenderer.on("app-warning", listener);
    return () => ipcRenderer.removeListener("app-warning", listener);
  },
  // Background jobs: creating and deleting bells.
  queueCreate: (assignments) => ipcRenderer.invoke("queue-create", { assignments }),
  queueDelete: (bells) => ipcRenderer.invoke("queue-delete", { bells }),
  getJobs: () => ipcRenderer.invoke("get-jobs"),
  cancelJob: (id) => ipcRenderer.invoke("cancel-job", { id }),
  resumeJobs: () => ipcRenderer.invoke("resume-jobs"),
  clearFinishedJobs: () => ipcRenderer.invoke("clear-finished-jobs"),
  onJobs: (callback) => {
    const listener = (event, snapshot) => callback(snapshot);
    ipcRenderer.on("jobs-update", listener);
    return () => ipcRenderer.removeListener("jobs-update", listener);
  },

  onStatus: (callback) => {
    const listener = (event, text) => callback(text);
    ipcRenderer.on("status-update", listener);
    return () => ipcRenderer.removeListener("status-update", listener);
  },
});
