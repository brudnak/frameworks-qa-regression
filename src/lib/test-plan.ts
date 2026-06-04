export const DEFAULT_TEST_PLAN_PRIORITY = "P0";

export type TestEnvironmentTemplateId = "none" | "docker" | "k3s-ha" | "rke2-ha";

export type TestEnvironmentTemplateOption = {
  id: TestEnvironmentTemplateId;
  label: string;
};

export const testEnvironmentTemplateOptions: TestEnvironmentTemplateOption[] = [
  {
    id: "none",
    label: "Blank",
  },
  {
    id: "docker",
    label: "Docker",
  },
  {
    id: "k3s-ha",
    label: "K3s HA",
  },
  {
    id: "rke2-ha",
    label: "RKE2 HA",
  },
];

const reproductionStepsTemplate = `<details>
    <summary>Reproduction steps... Click to expand</summary>


## Reproduction steps

1.

## Additional Info

## Reproduction Results

### ✅ (Reproduction) Expected

### ❌ (Reproduction) Actual

</details>`;

const environmentTemplates: Record<
  Exclude<TestEnvironmentTemplateId, "none">,
  string
> = {
  "docker": `## Reproduction Environment

<!-- docker install -->
| Component                        | Version / Type         |
| -------------------------------- | ---------------------- |
| Rancher version                  |                        |
| Rancher commit link              |                        |
| Installation option              | Docker                 |
| Cert Details                     | \`--acme-domain\`        |
| Docker version                   | 20.10.7, build f0df350 |
| Helm version                     |                        |
| Downstream cluster type          |                        |
| Downstream K8s version           |                        |
| Authentication providers enabled |                        |
| Logged in user role              |                        |
| Browser type                     |                        |
| Browser version                  |                        |
| Dashboard                        |                        |
| Webhook version                  |                        |

${reproductionStepsTemplate}`,
  "k3s-ha": `## Reproduction Environment

<!-- k3s high availability -->
| Component                        | Version / Type                       |
| -------------------------------- | ------------------------------------ |
| Rancher version starting         |                                      |
| Rancher version upgraded         |                                      |
| Rancher commit link              |                                      |
| Installation option              | Helm (high availability)             |
| If Helm Chart k8s cluster        |                                      |
| Cert Details                     | external tls \`aws acm\`               |
| k3s ha external db               | Aurora MySQL 5.7.mysql_aurora.2.11.1 |
| Helm version                     |                                      |
| Downstream cluster type          |                                      |
| Downstream K8s version           |                                      |
| Authentication providers enabled |                                      |
| Logged in user role              |                                      |
| Browser type                     |                                      |
| Browser version                  |                                      |
| Dashboard                        |                                      |
| Webhook version                  |                                      |

${reproductionStepsTemplate}`,
  "rke2-ha": `## Reproduction Environment

<!-- rke2 high availability -->
| Component                        | Version / Type           |
| -------------------------------- | ------------------------ |
| Rancher version starting         |                          |
| Rancher version upgraded         |                          |
| RKE2 Local K8s Version           |                          |
| Installation option              | Helm (high availability) |
| Cert Details                     | external tls \`aws acm\`   |
| Downstream cluster type          |                          |
| Downstream K8s version           |                          |
| Authentication providers enabled |                          |
| Logged in user role              |                          |
| Browser type                     |                          |
| Browser version                  |                          |
| Dashboard                        |                          |
| Webhook version                  |                          |

${reproductionStepsTemplate}`,
};

export function parseTestScenarioLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function getTestEnvironmentTemplateMarkdown(
  templateId: TestEnvironmentTemplateId,
) {
  if (templateId === "none") {
    return "";
  }

  return environmentTemplates[templateId];
}

export function generateTestPlanMarkdown(
  scenarioTitles: string[],
  priority = DEFAULT_TEST_PLAN_PRIORITY,
  environmentTemplateId: TestEnvironmentTemplateId = "none",
) {
  const titles = scenarioTitles.map((title) => title.trim()).filter(Boolean);
  const normalizedPriority = priority.trim() || DEFAULT_TEST_PLAN_PRIORITY;
  const environmentTemplate = getTestEnvironmentTemplateMarkdown(
    environmentTemplateId,
  );
  const tableRows = titles
    .map(
      (title, index) =>
        `| ${index + 1}   | ${normalizedPriority}       | [${title}](#test-${
          index + 1
        })  | ⏸️ NOT TESTED YET |`,
    )
    .join("\n");
  const testDetails = titles
    .map(
      (title, index) => `# ${index + 1} / ${title} Status: ⏸️ NOT TESTED YET

<a name="test-${index + 1}"></a>

**:small_red_triangle: [back to top](#top)**

<details>
    <summary>Test ${index + 1} details... Click to expand</summary>

**Test Steps for Validation**

1. step 1
2. step 2

**✅ Expected Outcome**

**✅ Actual Outcome**


</details>
<hr>`,
    )
    .join("\n\n");

  return `<!-- -->
<!-- -->

<details>
    <summary>🧪 Test Environment... CLICK TO EXPAND! ⬅️</summary>
<br>

${environmentTemplate}

</details>

<a name="top"></a>

### 🧪 Test Cases

| \\\\#  | Priority | Description & Link | PASS/FAIL        |
| --- | -------- | ------------------ | ---------------- |
${tableRows}

<details>
    <summary>🚨 ${titles.length} test cases... CLICK TO EXPAND! (For table links to work) ⬅️</summary>
<br>

${testDetails}

</details>`;
}
