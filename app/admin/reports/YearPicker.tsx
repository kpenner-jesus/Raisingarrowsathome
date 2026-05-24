"use client";

export function YearPicker({ year, options }: { year: number; options: number[] }) {
  return (
    <form method="get">
      <label className="ra-label" style={{ display: "block" }}>Year</label>
      <select
        name="year"
        defaultValue={String(year)}
        className="ra-input"
        onChange={(e) => e.currentTarget.form?.submit()}
      >
        {options.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
      <noscript>
        <button type="submit" className="ra-btn" style={{ marginTop: 4 }}>Apply</button>
      </noscript>
    </form>
  );
}
