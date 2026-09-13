// @ts-nocheck -- ported from the original site; behavior preserved, not yet fully typed.
import { requireAuth } from './auth';
import { APP_CONFIG } from './app-config';
import { renderShell } from './shell';
import { auth } from './firebase';

export const FEEDBACK_RATINGS = [
  ["easeOfUse", "Ease of Use"],
  ["userInterface", "User Interface"],
  ["navigation", "Navigation"],
  ["speedPerformance", "Speed / Performance"],
  ["accuracyInformation", "Accuracy of Information"],
  ["usefulness", "Usefulness"],
  ["overallSatisfaction", "Overall Satisfaction"],
];

export const FEEDBACK_REQUEST_TIMEOUT_MS = 15000;
export let feedbackSubmitting = false;

export function feedbackApiConfigured() {
  return typeof APP_CONFIG?.feedbackApiUrl === "string" && APP_CONFIG.feedbackApiUrl.startsWith("http");
}

export async function submitFeedback(payload) {
  if (!feedbackApiConfigured()) throw new Error("Feedback is not connected yet. Ask the website administrator to finish the setup.");
  const user = auth.currentUser;
  if (!user) throw new Error("Your session has expired. Please sign in again.");
  const token = await user.getIdToken();
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), FEEDBACK_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(APP_CONFIG.feedbackApiUrl, {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "submitFeedback", token, ...payload }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Feedback service returned HTTP ${response.status}.`);
    const result = await response.json();
    if (!result.ok) throw new Error(result.error || "The feedback could not be submitted.");
    return result.data;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("The feedback service took too long to respond. Please try again.");
    if (error.message?.includes("Feedback service returned")) throw error;
    if (error.message?.includes("The feedback could not")) throw error;
    throw new Error("Could not reach the feedback service. Check your connection and try again.");
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export function renderFeedbackForm() {
  const mount = document.getElementById("feedbackRatingFields");
  if (!mount) return;
  mount.innerHTML = FEEDBACK_RATINGS.map(([id, label]) => `
    <div class="feedback-rating-field">
      <label for="feedback_${id}">${label}</label>
      <select id="feedback_${id}" name="${id}" required aria-required="true">
        <option value="">Select rating</option>
        <option value="5">5 - Excellent</option>
        <option value="4">4 - Very good</option>
        <option value="3">3 - Good</option>
        <option value="2">2 - Needs improvement</option>
        <option value="1">1 - Poor</option>
      </select>
    </div>`).join("");
}

export function setFeedbackStatus(message, type = "") {
  const status = document.getElementById("feedbackStatus");
  if (!status) return;
  status.textContent = message;
  status.className = `feedback-status ${type}`;
  status.hidden = !message;
}

export function initFeedback() {
  renderShell("feedback", "Website Feedback");
  renderFeedbackForm();
  const form = document.getElementById("feedbackForm");
  const email = document.getElementById("feedbackEmail");
  const user = auth.currentUser;
  if (email && user?.email) email.value = user.email;
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (feedbackSubmitting || !form.reportValidity()) return;
    feedbackSubmitting = true;
    const submitButton = document.getElementById("feedbackSubmitBtn");
    submitButton.disabled = true;
    submitButton.innerHTML = '<span class="inline-spinner" aria-hidden="true"></span> Sending feedback…';
    setFeedbackStatus("", "");
    const payload = Object.fromEntries(new FormData(form).entries());
    try {
      await submitFeedback(payload);
      form.reset();
      if (email && user?.email) email.value = user.email;
      setFeedbackStatus("Thank you. Your feedback has been recorded.", "success");
    } catch (error) {
      setFeedbackStatus(error.message || "Feedback could not be submitted.", "error");
    } finally {
      feedbackSubmitting = false;
      submitButton.disabled = false;
      submitButton.textContent = "Submit feedback";
    }
  });
}
