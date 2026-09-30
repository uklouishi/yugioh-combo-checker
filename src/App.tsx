/** 临时的数据预览页，用来确认 combo 数据和推导结果；正式的查看器在下一个阶段做。 */
import { combos, handtrapById } from "./data";
import { deriveInterruptions } from "./model/interruptions";

export function App() {
  return (
    <main style={{ maxWidth: 820, margin: "0 auto", padding: 16, fontFamily: "system-ui, sans-serif" }}>
      {combos.map((combo) => {
        const hits = deriveInterruptions(combo);
        return (
          <section key={combo.id}>
            <h1>{combo.title}</h1>
            <p>起手：{combo.starter.map((c) => c.name).join("、")}</p>
            <ol>
              {combo.steps.map((step) => (
                <li key={step.id} style={{ marginBottom: 12 }}>
                  <strong>{step.title}</strong>
                  <ul>
                    {hits
                      .filter((h) => h.stepId === step.id)
                      .map((h) => (
                        <li key={h.handtrap}>
                          ⚠ {handtrapById.get(h.handtrap)?.nameZh}：{h.note ?? h.reason}
                        </li>
                      ))}
                  </ul>
                </li>
              ))}
            </ol>
            <p>终场：{combo.endboard.description}</p>
          </section>
        );
      })}
    </main>
  );
}
