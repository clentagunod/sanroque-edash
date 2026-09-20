// @ts-nocheck -- ported from the original site; behavior preserved, not yet fully typed.
import { SHEETS_API_URL } from './firebase';

/**
 * DEMO-DATA.JS
 * Used only as a fallback so the interface is fully browsable the moment you
 * open it — before you've deployed the Apps Script backend. Every page tries
 * the real LPSApi call first; if SHEETS_API_URL is still the placeholder (or
 * the call fails), it falls back to this file and shows a banner saying so.
 * None of this is used once your Google Sheet is connected.
 */

export const DEMO_LEARNERS = [
  { learnerId: "LRN-0001", lastName: "Santos", firstName: "Maria Angela", gradeLevel: "Grade 3", section: "Diamond", dateAdded: "2024-05-27", is4Ps: true, isIP: false, isSNED: false, isARAL: false, guardian: "Ana Santos", contact: "0917-000-1111" },
  { learnerId: "LRN-0002", lastName: "Reyes", firstName: "John Carlo", gradeLevel: "Grade 4", section: "Ruby", dateAdded: "2024-05-26", is4Ps: false, isIP: true, isSNED: false, isARAL: true, guardian: "Liza Reyes", contact: "0917-000-2222" },
  { learnerId: "LRN-0003", lastName: "Dela Cruz", firstName: "Mark Joseph", gradeLevel: "Grade 2", section: "Sapphire", dateAdded: "2024-05-25", is4Ps: true, isIP: false, isSNED: true, isARAL: false, guardian: "Rosa Dela Cruz", contact: "0917-000-3333" },
  { learnerId: "LRN-0004", lastName: "Garcia", firstName: "Sofia Loren", gradeLevel: "Grade 1", section: "Emerald", dateAdded: "2024-05-24", is4Ps: false, isIP: false, isSNED: false, isARAL: false, guardian: "Peter Garcia", contact: "0917-000-4444" },
  { learnerId: "LRN-0005", lastName: "Mendoza", firstName: "Daniel Kyle", gradeLevel: "Grade 5", section: "Topaz", dateAdded: "2024-05-24", is4Ps: true, isIP: false, isSNED: false, isARAL: true, guardian: "Grace Mendoza", contact: "0917-000-5555" },
  { learnerId: "LRN-0006", lastName: "Bautista", firstName: "Ella Marie", gradeLevel: "Kinder", section: "Amber", dateAdded: "2024-05-23", is4Ps: false, isIP: true, isSNED: false, isARAL: false, guardian: "Noel Bautista", contact: "0917-000-6666" },
  { learnerId: "LRN-0007", lastName: "Villanueva", firstName: "Miguel Angelo", gradeLevel: "Grade 3", section: "Diamond", dateAdded: "2024-05-22", is4Ps: false, isIP: false, isSNED: true, isARAL: false, guardian: "Carmen Villanueva", contact: "0917-000-7777" },
  { learnerId: "LRN-0008", lastName: "Aquino", firstName: "Nicole Faith", gradeLevel: "Grade 4", section: "Ruby", dateAdded: "2024-05-21", is4Ps: true, isIP: false, isSNED: false, isARAL: false, guardian: "Edwin Aquino", contact: "0917-000-8888" },
];

export const DEMO_SUMMARY = {
  totalLearners: 1248,
  fourPsCount: 312,
  ipCount: 86,
  snedCount: 47,
  aralCount: 123,
  notTaggedCount: 927,
  gradeLevels: [
    { label: "Kinder", value: 153 },
    { label: "Grade 1", value: 198 },
    { label: "Grade 2", value: 216 },
    { label: "Grade 3", value: 228 },
    { label: "Grade 4", value: 241 },
    { label: "Grade 5", value: 212 },
  ],
  recentLearners: DEMO_LEARNERS.slice(0, 5),
  lastSynced: "May 27, 2024 8:30 AM",
};

export const DEMO_BREAKDOWN = [
  { gradeLevel: "Kinder", total: 153, fourPs: 38, ip: 11, sned: 6, aral: 15 },
  { gradeLevel: "Grade 1", total: 198, fourPs: 49, ip: 14, sned: 7, aral: 19 },
  { gradeLevel: "Grade 2", total: 216, fourPs: 54, ip: 15, sned: 8, aral: 21 },
  { gradeLevel: "Grade 3", total: 228, fourPs: 57, ip: 16, sned: 8, aral: 22 },
  { gradeLevel: "Grade 4", total: 241, fourPs: 60, ip: 17, sned: 9, aral: 24 },
  { gradeLevel: "Grade 5", total: 212, fourPs: 54, ip: 13, sned: 9, aral: 22 },
];

export const DEMO_USERS = [
  { userId: "USR-001", name: "Juan Dela Cruz", email: "juan.delacruz@sanroquees.edu.ph", role: "School Admin", status: "Active" },
  { userId: "USR-002", name: "Rona Fernandez", email: "rona.fernandez@sanroquees.edu.ph", role: "Registrar", status: "Active" },
  { userId: "USR-003", name: "Michael Ong", email: "michael.ong@sanroquees.edu.ph", role: "Teacher", status: "Invited" },
];

export function isSheetsApiConfigured() {
  return typeof SHEETS_API_URL === "string" && SHEETS_API_URL.startsWith("http");
}
