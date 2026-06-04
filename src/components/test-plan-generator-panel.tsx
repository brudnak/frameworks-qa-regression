"use client";

import { useMemo, useState } from "react";
import {
  DEFAULT_TEST_PLAN_PRIORITY,
  generateTestPlanMarkdown,
  parseTestScenarioLines,
  testEnvironmentTemplateOptions,
  type TestEnvironmentTemplateId,
} from "@/lib/test-plan";

const sampleScenarios = `First Test Case
Second Test Case
Third Test Case`;

export function TestPlanGeneratorPanel() {
  const [scenarioText, setScenarioText] = useState(sampleScenarios);
  const [priority, setPriority] = useState(DEFAULT_TEST_PLAN_PRIORITY);
  const [environmentTemplate, setEnvironmentTemplate] =
    useState<TestEnvironmentTemplateId>("none");
  const [generatedMarkdown, setGeneratedMarkdown] = useState("");
  const [copyStatus, setCopyStatus] = useState("");

  const scenarioTitles = useMemo(
    () => parseTestScenarioLines(scenarioText),
    [scenarioText],
  );
  const canCreate = scenarioTitles.length > 0;

  function createMarkdown() {
    setGeneratedMarkdown(
      generateTestPlanMarkdown(scenarioTitles, priority, environmentTemplate),
    );
    setCopyStatus("");
  }

  async function copyMarkdown() {
    if (!generatedMarkdown) {
      return;
    }

    await navigator.clipboard.writeText(generatedMarkdown);
    setCopyStatus("Copied markdown to clipboard.");
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="section-label">Test Plan</p>
          <h3 className="panel-title">Generate GitHub comment markdown</h3>
          <p className="field-help">
            Paste one testcase scenario per line, then create a Markdown test plan
            with the table, anchors, and expandable details sections.
          </p>
        </div>
      </div>

      <div className="test-plan-grid">
        <div className="test-plan-form">
          <label className="field-shell">
            <span className="field-label">Default Priority</span>
            <select
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
            >
              <option value="P0">P0</option>
              <option value="P1">P1</option>
              <option value="P2">P2</option>
              <option value="P3">P3</option>
            </select>
          </label>

          <label className="field-shell">
            <span className="field-label">Environment Tested</span>
            <select
              value={environmentTemplate}
              onChange={(event) =>
                setEnvironmentTemplate(
                  event.target.value as TestEnvironmentTemplateId,
                )
              }
            >
              {testEnvironmentTemplateOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field-shell">
            <span className="field-label">Testcase Scenarios</span>
            <textarea
              className="test-plan-input"
              placeholder="One test title per line"
              value={scenarioText}
              onChange={(event) => setScenarioText(event.target.value)}
            />
            <span className="field-help">
              {scenarioTitles.length} non-empty scenario
              {scenarioTitles.length === 1 ? "" : "s"} ready.
            </span>
          </label>

          <div className="button-row">
            <button
              className="primary-button"
              disabled={!canCreate}
              onClick={createMarkdown}
              type="button"
            >
              Create Markdown
            </button>
            <button
              className="ghost-button"
              disabled={!generatedMarkdown}
              onClick={copyMarkdown}
              type="button"
            >
              Copy
            </button>
          </div>

          {copyStatus ? (
            <div className="status-banner success">{copyStatus}</div>
          ) : null}
        </div>

        <div className="test-plan-output-shell">
          <div className="test-plan-output-header">
            <span className="field-label">Markdown Output</span>
            <span className="field-help">
              {generatedMarkdown
                ? `${generatedMarkdown.length.toLocaleString()} characters`
                : "Nothing generated yet"}
            </span>
          </div>
          <pre className="terminal-output test-plan-output">
            {generatedMarkdown ||
              "Click Create Markdown to generate a GitHub-comment-ready test plan."}
          </pre>
        </div>
      </div>
    </section>
  );
}
