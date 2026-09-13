// @ts-nocheck -- ported from the original site; behavior preserved, not yet fully typed.
import { appDateInputValue, showToast } from './shell';
import { LPSApi } from './sheets-api';

export let archiveEditorState = null;

export function archiveDateInputValue(value) {
  return typeof appDateInputValue === "function" ? appDateInputValue(value) : "";
}

export function ensureArchiveEditor() {
  if (document.getElementById("archiveEditorBackdrop")) return;
  document.body.insertAdjacentHTML("beforeend", `<div class="modal-backdrop" id="archiveEditorBackdrop"><div class="modal archive-editor-modal"><div class="modal-header"><h3 id="archiveEditorTitle">Edit archived learner</h3><button class="modal-close" type="button" id="archiveEditorClose" aria-label="Close"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div><form id="archiveEditorForm"><div class="modal-body"><div class="field-grid"><div class="field"><label for="archiveFirstName">First name</label><input id="archiveFirstName" required /></div><div class="field"><label for="archiveMiddleName">Middle name</label><input id="archiveMiddleName" /></div><div class="field"><label for="archiveLastName">Last name</label><input id="archiveLastName" required /></div><div class="field"><label for="archiveBirthDate">Birthdate</label><input id="archiveBirthDate" type="date" /></div><div class="field"><label for="archiveGrade">Grade level</label><input id="archiveGrade" /></div><div class="field"><label for="archiveSection">Section</label><input id="archiveSection" /></div><div class="field"><label for="archiveGender">Gender</label><select id="archiveGender" required aria-required="true"><option value="">Select gender</option><option>Male</option><option>Female</option></select></div><div class="field"><label for="archiveDateAdded">Date added</label><input id="archiveDateAdded" type="date" /></div><div class="field span-2"><label for="archiveTransferSchool">Transfer school</label><input id="archiveTransferSchool" /></div><div class="field span-2"><label for="archiveReason">Reason / notes</label><textarea id="archiveReason" rows="3"></textarea></div></div></div><div class="modal-footer"><button class="btn btn-secondary" type="button" id="archiveEditorCancel">Cancel</button><button class="btn btn-primary" type="submit" id="archiveEditorSave">Save changes</button></div></form></div></div>`);
  const close = () => document.getElementById("archiveEditorBackdrop").classList.remove("is-open");
  document.getElementById("archiveEditorClose").addEventListener("click", close);
  document.getElementById("archiveEditorCancel").addEventListener("click", close);
  document.getElementById("archiveEditorBackdrop").addEventListener("click", (event) => { if (event.target.id === "archiveEditorBackdrop") close(); });
  document.getElementById("archiveEditorForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = document.getElementById("archiveEditorSave");
    if (!archiveEditorState || !event.target.reportValidity()) return;
    button.disabled = true;
    try {
      const sentenceCaseName = (value) => { const text = String(value || "").trim().toLowerCase(); return text ? text.charAt(0).toUpperCase() + text.slice(1) : ""; };
      const record = { ...archiveEditorState.record, firstName: sentenceCaseName(document.getElementById("archiveFirstName").value), middleName: sentenceCaseName(document.getElementById("archiveMiddleName").value), lastName: sentenceCaseName(document.getElementById("archiveLastName").value), birthDate: document.getElementById("archiveBirthDate").value, gradeLevel: document.getElementById("archiveGrade").value.trim(), section: document.getElementById("archiveSection").value.trim(), gender: document.getElementById("archiveGender").value, dateAdded: document.getElementById("archiveDateAdded").value, transferSchool: document.getElementById("archiveTransferSchool").value.trim(), transferReason: document.getElementById("archiveReason").value.trim() };
      await LPSApi.updateArchiveRecord(archiveEditorState.archive, archiveEditorState.schoolYear, archiveEditorState.record.learnerId, record);
      close();
      await archiveEditorState.reload();
      showToast("Archived learner updated.", "success");
    } catch (error) { showToast(error.message || "The archived learner could not be updated.", "error"); }
    finally { button.disabled = false; }
  });
  ["archiveFirstName", "archiveMiddleName", "archiveLastName"].forEach((id) => {
    document.getElementById(id).addEventListener("blur", (event) => {
      const text = String(event.target.value || "").trim().toLowerCase();
      event.target.value = text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
    });
  });
}

export function openArchiveEditor(archive, schoolYear, record, reload) {
  ensureArchiveEditor();
  archiveEditorState = { archive, schoolYear, record, reload };
  document.getElementById("archiveEditorTitle").textContent = archive === "dropout" ? "Edit dropout record" : "Edit transfer record";
  document.getElementById("archiveFirstName").value = record.firstName || "";
  document.getElementById("archiveMiddleName").value = record.middleName || "";
  document.getElementById("archiveLastName").value = record.lastName || "";
  document.getElementById("archiveBirthDate").value = archiveDateInputValue(record.birthDate);
  document.getElementById("archiveGrade").value = record.gradeLevel || "";
  document.getElementById("archiveSection").value = record.section || "";
  document.getElementById("archiveGender").value = record.gender || "";
  document.getElementById("archiveDateAdded").value = archiveDateInputValue(record.dateAdded);
  document.getElementById("archiveTransferSchool").value = record.transferSchool || "";
  document.getElementById("archiveReason").value = record.transferReason || record.transferNotes || "";
  document.getElementById("archiveEditorBackdrop").classList.add("is-open");
}

export async function deleteArchiveRecord(archive, schoolYear, record, reload) {
  if (!window.confirm(`Delete ${record.firstName || "this"} ${record.lastName || "learner"} from the archive?`)) return;
  try { await LPSApi.deleteArchiveRecord(archive, schoolYear, record.learnerId); await reload(); showToast("Archived learner deleted.", "success"); }
  catch (error) { showToast(error.message || "The archived learner could not be deleted.", "error"); }
}
