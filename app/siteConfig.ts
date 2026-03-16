// ============================================================
//  siteConfig.ts — ALL RAISING ARROWS CONTENT IN ONE PLACE
//
//  This is the single file to update when any content changes.
//  Every page reads from here — names, amounts, questions, etc.
// ============================================================

export const SITE_CONFIG = {

  // ── ORGANIZATION ─────────────────────────────────────────
  orgName:      "Raising Arrows",
  orgTagline:   "Helping Christian families launch into homeschooling",
  orgEmail:     "register@raisingarrowsathome.com",
  orgWebsite:   "https://raisingarrowsathome.ca",
  orgProvince:  "Manitoba",

  // ── GRANT DETAILS ─────────────────────────────────────────
  // Reimbursement rate shown to applicants
  reimbursementRate: 75,

  // Funding caps by age range
  // These appear on the landing page and in the application
  fundingCaps: [
    { label: "Ages 5–8",   cap: 375,  spend: 500  },
    { label: "Ages 8–12",  cap: 500,  spend: 667  },
    { label: "Ages 12–15", cap: 650,  spend: 867  },
    { label: "Ages 15–18", cap: 750,  spend: 1000 },
  ],

  // ── INCOME RANGES ─────────────────────────────────────────
  incomeRanges: [
    "Under $60,000",
    "$60,000 – $90,000",
    "$90,000 – $120,000",
    "$120,000+",
  ],

  // ── GRADES ────────────────────────────────────────────────
  grades: [
    "Kindergarten",
    "Grade 1", "Grade 2", "Grade 3", "Grade 4",
    "Grade 5", "Grade 6", "Grade 7", "Grade 8",
    "Grade 9", "Grade 10", "Grade 11", "Grade 12",
  ],

  // ── CURRENT SCHOOLING OPTIONS ─────────────────────────────
  schoolingOptions: [
    "Public school",
    "Private / Christian school",
    "Not yet in school",
    "Other",
  ],

  // ── WRITTEN QUESTIONS ─────────────────────────────────────
  // These appear one at a time in the Typeform-style flow.
  // To reorder questions: move the objects around in this array.
  // To add a question: add a new object following the same shape.
  questions: [
    {
      key: "whyHomeschool",
      question: "Why do you want to homeschool?",
      hint: "Share what's drawing your family toward this decision.",
      placeholder: "We feel called to...",
    },
    {
      key: "biggestConcern",
      question: "What concerns you most about homeschooling?",
      hint: "Be honest — there are no wrong answers here.",
      placeholder: "Our biggest concern is...",
    },
    {
      key: "educationalGoals",
      question: "What are your educational goals for your children?",
      hint: "Think beyond academics — what kind of people do you want to raise?",
      placeholder: "We want our children to...",
    },
    {
      key: "whatGrantMakesPossible",
      question: "What would this grant make possible for your family?",
      hint: "Help us understand the practical difference it would make.",
      placeholder: "This grant would allow us to...",
    },
    {
      key: "singleIncome",
      question: "Are you transitioning to a single income to homeschool?",
      hint: "If yes, tell us a little about that transition.",
      placeholder: "Yes / No — and if yes...",
    },
    {
      key: "christianFaith",
      question: "How would you describe your Christian faith and how it influences your parenting?",
      hint: "We are a faith-based organization — share freely.",
      placeholder: "Our faith shapes our parenting by...",
    },
    {
      key: "localChurch",
      question: "Are you connected to a local church? If yes, which one?",
      hint: "Community matters to us.",
      placeholder: "Yes, we attend...",
    },
    {
      key: "curriculumConsidering",
      question: "What curriculum or approach are you considering for your first year?",
      hint: "It is totally fine if you are still exploring — just share where you are.",
      placeholder: "We are considering...",
    },
    {
      key: "howGrantHelps",
      question: "How would this grant help your family begin homeschooling?",
      hint: "This is your final chance to make your case — be specific.",
      placeholder: "This grant would help us by...",
    },
  ],

  // ── WHAT ACCEPTED FAMILIES RECEIVE ────────────────────────
  bonusItems: [
    "Free registration to MACHS",
    "2 conference tickets for the upcoming MACHS conference",
    "A welcome gift (age appropriate for your child)",
  ],

  // ── FAQ ───────────────────────────────────────────────────
  faqs: [
    {
      q: "How long does it take to hear back?",
      a: "You will hear back within 30 days of submitting your written questionnaire and short video interview.",
    },
    {
      q: "How does the reimbursement process work?",
      a: "When approved, submit your receipts to receipts@raisingarrowsathome.com and an e-transfer will be sent within 7 days of us receiving them.",
    },
    {
      q: "Who qualifies?",
      a: "Families considering homeschool for the first time who have never registered with the government previously for any of their children, and who are financially strained by the prospect of starting.",
    },
  ],

  // ── VIDEO INTERVIEW QUESTIONS ─────────────────────────────
  videoQuestions: [
    "Why do you want to homeschool?",
    "What excites you about it?",
    "What concerns you?",
  ],
};
