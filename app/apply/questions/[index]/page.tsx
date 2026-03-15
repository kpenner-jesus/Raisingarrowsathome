"use client";
import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useAppStore } from "../../../store";
import { SITE_CONFIG } from "../../../siteConfig";

export default function QuestionPage() {
  const router = useRouter();
  const params = useParams();
  const idx    = parseInt(params.index as string, 10);

  const questions = SITE_CONFIG.questions;
  const question  = questions[idx];

  // Read all question answers from store
  const store = useAppStore((s) => s);

  // Map question key to store getter and setter
  const answerMap: Record<string, { value: string; set: (v: string) => void }> = {
    whyHomeschool:          { value: store.whyHomeschool,          set: store.setWhyHomeschool },
    biggestConcern:         { value: store.biggestConcern,         set: store.setBiggestConcern },
    educationalGoals:       { value: store.educationalGoals,       set: store.setEducationalGoals },
    whatGrantMakesPossible: { value: store.whatGrantMakesPossible, set: store.setWhatGrantMakesPossible },
    singleIncome:           { value: store.singleIncome,           set: store.setSingleIncome },
    christianFaith:         { value: store.christianFaith,         set: store.setChristianFaith },
    localChurch:            { value: store.localChurch,            set: store.setLocalChurch },
    curriculumConsidering:  { value: store.curriculumConsidering,  set: store.setCurriculumConsidering },
    howGrantHelps:          { value: store.howGrantHelps,          set: store.setHowGrantHelps },
  };

  const current   = answerMap[question?.key];
  const [text, setText] = useState(current?.value || "");
  const [error, setError] = useState("");

  const totalQuestions = questions.length;

  // Progress: questions are steps 2 through (2 + totalQuestions)
  // Step 1 = family info, steps 2..10 = questions, step 11 = income, etc.
  const overallStep    = 2 + idx;
  const totalSteps     = 6;
  const progress       = Math.round((overallStep / (totalSteps + totalQuestions - 1)) * 100);

  // Question-specific progress (e.g. "Question 3 of 9")
  const questionProgress = Math.round(((idx + 1) / totalQuestions) * 100);

  if (!question) {
    router.replace("/apply/family");
    return null;
  }

  const handleContinue = () => {
    if (!text.trim()) {
      setError("Please answer this question before continuing.");
      return;
    }
    current.set(text.trim());

    if (idx + 1 < totalQuestions) {
      router.push(`/apply/questions/${idx + 1}`);
    } else {
      router.push("/apply/income");
    }
  };

  const handleBack = () => {
    if (idx === 0) {
      router.push("/apply/family");
    } else {
      router.push(`/apply/questions/${idx - 1}`);
    }
  };

  return (
    <div className="tf-step">
      <div className="tf-progress">
        <div className="tf-progress-fill" style={{ width: `${progress}%` }} />
      </div>

      <div className="tf-body">

        {/* Question counter */}
        <div className="tf-animate" style={{ marginBottom: "0.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.25rem" }}>
            <div className="tf-step-label" style={{ margin: 0 }}>
              Question {idx + 1} of {totalQuestions}
            </div>
          </div>
          {/* Mini progress bar just for questions */}
          <div style={{ height: 3, background: "rgba(0,0,0,0.07)", borderRadius: 2, overflow: "hidden", width: "100%", maxWidth: 200 }}>
            <div style={{
              height: "100%", borderRadius: 2,
              background: "var(--accent)",
              width: `${questionProgress}%`,
              transition: "width 0.4s ease",
            }} />
          </div>
        </div>

        <h1 className="tf-question tf-animate tf-animate-delay-1">
          {question.question}
        </h1>

        {question.hint && (
          <p className="tf-subtext tf-animate tf-animate-delay-2">
            {question.hint}
          </p>
        )}

        <div className="tf-animate tf-animate-delay-2" style={{ width: "100%" }}>
          <textarea
            value={text}
            onChange={(e) => { setText(e.target.value); setError(""); }}
            placeholder={question.placeholder}
            rows={5}
            autoFocus
            className="tf-input-box"
            style={{ resize: "vertical", minHeight: 120 }}
          />

          {/* Character encouragement */}
          {text.length > 0 && text.length < 50 && (
            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.35rem" }}>
              Keep going — a little more detail helps us understand your family better.
            </div>
          )}
          {text.length >= 50 && (
            <div style={{ fontSize: "0.72rem", color: "var(--accent)", marginTop: "0.35rem" }}>
              ✓ Great answer
            </div>
          )}
        </div>

        {error && (
          <div className="tf-alert-error" style={{ marginTop: "1rem" }}>
            {error}
          </div>
        )}

        <button className="tf-ok" onClick={handleContinue} style={{ marginTop: "1.5rem" }}>
          {idx + 1 < totalQuestions ? "Next question" : "Continue to income"}
          <svg viewBox="0 0 16 16" fill="none">
            <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        <div className="tf-hint">
          <kbd>Enter</kbd>
          <span>to continue</span>
        </div>

        <button className="tf-back" onClick={handleBack}>← Back</button>
      </div>
    </div>
  );
}
```

---

**Important note for GitHub:** The folder name must be literally `[index]` with the square brackets — that's how Next.js dynamic routes work. So the full path is:
```
app/apply/questions/[index]/page.tsx
