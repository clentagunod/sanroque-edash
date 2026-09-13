// @ts-nocheck -- ported from the original site; behavior preserved, not yet fully typed.
import { renderShell, showToast } from './shell';
import { requireAuth } from './auth';

export const UTILITY_SUBJECTS = [
  ["Filipino", "Filipino"], ["English", "English"], ["Math", "Math"], ["Science", "Science"],
  ["AralPan", "AralPan"], ["ESP", "ESP"], ["Music", "Music"], ["Arts", "Arts"],
  ["PE", "PE"], ["Health", "Health"], ["EPP", "EPP"], ["MotherTongue", "Mother Tongue"],
];

export function initUtilities() {
  const page = document.querySelector("[data-utility-page]")?.dataset.utilityPage || "utilities";
  const pageTitles = { utilities: "Utilities", grade: "Grade Calculator", bmi: "BMI Calculator" };
  renderShell(page === "grade" ? "grade-calculator" : page === "bmi" ? "bmi-calculator" : "utilities", pageTitles[page]);
  const subjectGrid = document.getElementById("utilitySubjectGrid");
  if (subjectGrid) {
    subjectGrid.innerHTML = UTILITY_SUBJECTS.map(([id, label]) => `<label>${label}<input id="utility_${id}" type="number" min="60" max="100" step="0.01" placeholder="-" /></label>`).join("");
  }
  document.getElementById("calculateGradeBtn")?.addEventListener("click", calculateUtilityGrade);
  document.getElementById("resetGradeBtn")?.addEventListener("click", () => resetUtilityInputs("utilitySubjectGrid", "gradeResult", "Average", "Enter at least one grade from 60 to 100."));
  document.getElementById("calculateBmiBtn")?.addEventListener("click", calculateUtilityBmi);
  document.getElementById("resetBmiBtn")?.addEventListener("click", () => resetUtilityInputs("utility-bmi-grid", "bmiResult", "BMI", "Enter a valid height and weight."));
}

export function setUtilityResult(id, value, note) {
  const result = document.getElementById(id);
  result.classList.remove("is-error");
  result.querySelector("strong").textContent = value;
  result.querySelector("small").textContent = note;
}

export function utilityError(id, message) {
  const result = document.getElementById(id);
  result.classList.add("is-error");
  result.querySelector("strong").textContent = "Check input";
  result.querySelector("small").textContent = message;
}

export function calculateUtilityGrade() {
  const values = UTILITY_SUBJECTS.map(([id]) => Number(document.getElementById(`utility_${id}`).value)).filter((value) => Number.isFinite(value));
  if (!values.length) { utilityError("gradeResult", "Enter at least one grade from 60 to 100."); return; }
  if (values.some((value) => value < 60 || value > 100)) { utilityError("gradeResult", "Grades must be between 60 and 100."); return; }
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  setUtilityResult("gradeResult", average.toFixed(2), `${values.length} subject${values.length === 1 ? "" : "s"} included`);
}

export function calculateUtilityBmi() {
  const height = Number(document.getElementById("utilityHeight").value);
  const weight = Number(document.getElementById("utilityWeight").value);
  if (!Number.isFinite(height) || !Number.isFinite(weight) || height < 0.3 || height > 2.5 || weight <= 0 || weight > 300) {
    utilityError("bmiResult", "Use a height from 0.30–2.50 m and weight from 1–300 kg."); return;
  }
  const bmi = weight / (height ** 2);
  setUtilityResult("bmiResult", bmi.toFixed(2), "For children, interpret BMI using age- and sex-specific percentiles.");
}

export function resetUtilityInputs(containerId, resultId, label, note) {
  document.querySelectorAll(`#${containerId} input`).forEach((input) => { input.value = ""; });
  const result = document.getElementById(resultId);
  result.classList.remove("is-error");
  result.querySelector("span").textContent = label;
  result.querySelector("strong").textContent = "—";
  result.querySelector("small").textContent = note;
}
