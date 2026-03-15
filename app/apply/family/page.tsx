"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "../../store";
import { SITE_CONFIG } from "../../siteConfig";

interface Child { age: number; grade: string; }

export default function FamilyPage() {
  const router = useRouter();
  const stored = useAppStore((s) => s);

  const [parentNames,     setParentNames]     = useState(stored.parentNames     || "");
  const [city,            setCity]            = useState(stored.city            || "");
  const [currentSchooling,setCurrentSchooling]= useState(stored.currentSchooling|| "");
  const [children,        setChildren]        = useState<Child[]>(
    stored.children.length > 0 ? stored.children : [{ age: 0, grade: "" }]
  );
  const [error, setError] = useState("");

  const progress = Math.round((1 / 6) * 100);

  const addChild = () => setChildren([...children, { age: 0, grade: "" }]);
  const removeChild = (i: number) => setChildren(children.filter((_, idx) => idx !== i));
  const updateChild = (i: number, field: keyof Child, value: string | number) => {
    const updated = [...children];
    updated[i] = { ...updated[i], [field]: value };
    setChildren(updated);
  };

  const handleContinue = () => {
    if (!parentNames.trim()) { setError("Please enter the parent name(s)."); return; }
    if (!city.trim())        { setError("Please enter your city or town."); return; }
    if (children.some((c) => !c.grade)) { setError("Please select a grade for each child."); return; }
    if (children.some((c) => c.age < 1 || c.age > 18)) { setError("Please enter a valid age for each child."); return; }
    if (!currentSchooling) { setError("Please select your current schooling situation."); return; }

    stored.setParentNames(parentNames.trim());
    stored.setCity(city.trim());
    stored.setChildren(children);
    stored.setCurrentSchooling(currentSchooling);
    router.push("/apply/questions/0");
  };

  const inputLabel = (text: string, required = true) => (
    <label style={{ fontSize: "0.72rem", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase" as const, color: "var(--text-muted)", display: "block", marginBottom: "0.5rem" }}>
      {text} {!required && <span style={{ fontWeight: 400, textTransform: "none" as const, letterSpacing: 0 }}>(optional)</span>}
    </label>
  );

  return (
    <div className="tf-step">
      <div className="tf-progress">
        <div className="tf-progress-fill" style={{ width: `${progress}%` }} />
      </div>

      <div className="tf-body" style={{ justifyContent: "flex-start", paddingTop: "3rem" }}>
        <div className="tf-step-label tf-animate">Step 1 of 6</div>
        <h1 className="tf-question tf-animate tf-animate-delay-1">
          Tell us about your <em>family</em>
        </h1>
        <p className="tf-subtext tf-animate tf-animate-delay-2">
          Basic information to get started.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem", width: "100%" }}>

          {/* Parent names */}
          <div className="tf-animate tf-animate-delay-2">
            {inputLabel("Parent name(s)")}
            <input type="text" value={parentNames}
              onChange={(e) => { setParentNames(e.target.value); setError(""); }}
              placeholder="e.g. John & Sarah Penner"
              className="tf-input-box" />
          </div>

          {/* City */}
          <div className="tf-animate tf-animate-delay-3">
            {inputLabel("City or town")}
            <input type="text" value={city}
              onChange={(e) => { setCity(e.target.value); setError(""); }}
              placeholder="e.g. Winkler"
              className="tf-input-box" />
          </div>

          {/* Current schooling */}
          <div className="tf-animate tf-animate-delay-3">
            {inputLabel("Current schooling situation")}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {SITE_CONFIG.schoolingOptions.map((opt) => (
                <button key={opt}
                  onClick={() => { setCurrentSchooling(opt); setError(""); }}
                  style={{
                    padding: "0.75rem 1rem", textAlign: "left",
                    background: currentSchooling === opt ? "var(--text-primary)" : "rgba(255,255,255,0.72)",
                    color: currentSchooling === opt ? "white" : "var(--text-primary)",
                    border: `1.5px solid ${currentSchooling === opt ? "var(--text-primary)" : "rgba(0,0,0,0.09)"}`,
                    borderRadius: "var(--radius-md)", cursor: "pointer",
                    fontSize: "0.9rem", fontFamily: "var(--font-body)",
                    transition: "all 0.15s ease",
                  }}>
                  {opt}
                </button>
              ))}
            </div>
          </div>

          {/* Children */}
          <div className="tf-animate tf-animate-delay-4">
            {inputLabel("Children applying for the grant")}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {children.map((child, i) => (
                <div key={i} style={{
                  background: "rgba(255,255,255,0.72)", border: "1.5px solid rgba(0,0,0,0.09)",
                  borderRadius: "var(--radius-md)", padding: "1rem",
                  display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" as const,
                }}>
                  <div style={{ flex: 1, minWidth: 80 }}>
                    <div style={{ fontSize: "0.68rem", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: "var(--text-muted)", marginBottom: "0.35rem" }}>
                      Age
                    </div>
                    <input type="number" min={1} max={18} value={child.age || ""}
                      onChange={(e) => { updateChild(i, "age", parseInt(e.target.value) || 0); setError(""); }}
                      placeholder="e.g. 8"
                      style={{
                        width: "100%", padding: "0.5rem 0.75rem",
                        background: "white", border: "1px solid rgba(0,0,0,0.12)",
                        borderRadius: 8, fontSize: "0.9rem",
                        fontFamily: "var(--font-body)", color: "var(--text-primary)",
                        outline: "none",
                      }} />
                  </div>

                  <div style={{ flex: 2, minWidth: 140 }}>
                    <div style={{ fontSize: "0.68rem", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: "var(--text-muted)", marginBottom: "0.35rem" }}>
                      Grade
                    </div>
                    <select value={child.grade}
                      onChange={(e) => { updateChild(i, "grade", e.target.value); setError(""); }}
                      style={{
                        width: "100%", padding: "0.5rem 0.75rem",
                        background: "white", border: "1px solid rgba(0,0,0,0.12)",
                        borderRadius: 8, fontSize: "0.9rem",
                        fontFamily: "var(--font-body)", color: child.grade ? "var(--text-primary)" : "var(--text-muted)",
                        outline: "none", cursor: "pointer",
                      }}>
                      <option value="">Select grade</option>
                      {SITE_CONFIG.grades.map((g) => (
                        <option key={g} value={g}>{g}</option>
                      ))}
                    </select>
                  </div>

                  {children.length > 1 && (
                    <button onClick={() => removeChild(i)}
                      style={{
                        width: 32, height: 32, borderRadius: "50%",
                        border: "1px solid rgba(0,0,0,0.12)", background: "white",
                        color: "var(--text-muted)", cursor: "pointer",
                        fontSize: "1rem", display: "flex", alignItems: "center",
                        justifyContent: "center", flexShrink: 0,
                        fontFamily: "var(--font-body)",
                      }}>
                      ×
                    </button>
                  )}
                </div>
              ))}

              <button onClick={addChild}
                style={{
                  padding: "0.6rem 1rem", background: "transparent",
                  border: "1.5px dashed rgba(0,0,0,0.15)", borderRadius: "var(--radius-md)",
                  color: "var(--text-muted)", cursor: "pointer", fontSize: "0.85rem",
                  fontFamily: "var(--font-body)", transition: "all 0.15s ease",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--accent)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--accent)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(0,0,0,0.15)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)"; }}>
                + Add another child
              </button>
            </div>
          </div>
        </div>

        {error && <div className="tf-alert-error" style={{ marginTop: "1rem" }}>{error}</div>}

        <button className="tf-ok" onClick={handleContinue} style={{ marginTop: "1.5rem" }}>
          Continue
          <svg viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>

        <button className="tf-back" onClick={() => router.push("/")}>← Back to home</button>
      </div>
    </div>
  );
}
