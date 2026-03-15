// ============================================================
//  store.ts — APPLICATION STATE FOR RAISING ARROWS FUNNEL
//
//  Tracks every answer a family gives as they move through
//  the multi-step application. All pages read from and write
//  to this shared store so nothing is lost between steps.
// ============================================================

import { create } from "zustand";

interface Child {
  age: number;
  grade: string;
}

interface ApplicationState {
  // ── STEP 1: FAMILY INFO ──────────────────────────────────
  parentNames: string;
  city: string;
  children: Child[];
  currentSchooling: string;

  // ── STEP 2: WRITTEN QUESTIONS ────────────────────────────
  whyHomeschool: string;
  biggestConcern: string;
  educationalGoals: string;
  whatGrantMakesPossible: string;
  singleIncome: string;
  christianFaith: string;
  localChurch: string;
  curriculumConsidering: string;
  howGrantHelps: string;

  // ── STEP 3: INCOME ───────────────────────────────────────
  incomeRange: string;

  // ── STEP 4: VIDEO ────────────────────────────────────────
  videoLink: string;

  // ── STEP 5: CONTACT ──────────────────────────────────────
  contactEmail: string;
  contactPhone: string;

  // ── SETTERS ──────────────────────────────────────────────
  setParentNames: (v: string) => void;
  setCity: (v: string) => void;
  setChildren: (v: Child[]) => void;
  setCurrentSchooling: (v: string) => void;
  setWhyHomeschool: (v: string) => void;
  setBiggestConcern: (v: string) => void;
  setEducationalGoals: (v: string) => void;
  setWhatGrantMakesPossible: (v: string) => void;
  setSingleIncome: (v: string) => void;
  setChristianFaith: (v: string) => void;
  setLocalChurch: (v: string) => void;
  setCurriculumConsidering: (v: string) => void;
  setHowGrantHelps: (v: string) => void;
  setIncomeRange: (v: string) => void;
  setVideoLink: (v: string) => void;
  setContactEmail: (v: string) => void;
  setContactPhone: (v: string) => void;
  resetApplication: () => void;
}

const defaultState = {
  parentNames: "",
  city: "",
  children: [{ age: 0, grade: "" }],
  currentSchooling: "",
  whyHomeschool: "",
  biggestConcern: "",
  educationalGoals: "",
  whatGrantMakesPossible: "",
  singleIncome: "",
  christianFaith: "",
  localChurch: "",
  curriculumConsidering: "",
  howGrantHelps: "",
  incomeRange: "",
  videoLink: "",
  contactEmail: "",
  contactPhone: "",
};

export const useAppStore = create<ApplicationState>((set) => ({
  ...defaultState,
  setParentNames:            (v) => set({ parentNames: v }),
  setCity:                   (v) => set({ city: v }),
  setChildren:               (v) => set({ children: v }),
  setCurrentSchooling:       (v) => set({ currentSchooling: v }),
  setWhyHomeschool:          (v) => set({ whyHomeschool: v }),
  setBiggestConcern:         (v) => set({ biggestConcern: v }),
  setEducationalGoals:       (v) => set({ educationalGoals: v }),
  setWhatGrantMakesPossible: (v) => set({ whatGrantMakesPossible: v }),
  setSingleIncome:           (v) => set({ singleIncome: v }),
  setChristianFaith:         (v) => set({ christianFaith: v }),
  setLocalChurch:            (v) => set({ localChurch: v }),
  setCurriculumConsidering:  (v) => set({ curriculumConsidering: v }),
  setHowGrantHelps:          (v) => set({ howGrantHelps: v }),
  setIncomeRange:            (v) => set({ incomeRange: v }),
  setVideoLink:              (v) => set({ videoLink: v }),
  setContactEmail:           (v) => set({ contactEmail: v }),
  setContactPhone:           (v) => set({ contactPhone: v }),
  resetApplication:          () => set({ ...defaultState }),
}));
