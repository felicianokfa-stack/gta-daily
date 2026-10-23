import { describe, expect, it } from "vitest";
import { AnyAgentOutputEnvelope } from "@/core/contracts/common";
import { ResearchInput, ResearchResult, VerificationResult } from "@/core/contracts/research";
import { pesquisador } from "@/agents/pesquisador";
import { verificador } from "@/agents/verificador";
import { inputHash } from "@/orchestrator/hash";
import { SRC_A, SRC_B, researchResult, verificationResult } from "./helpers";

describe("contratos com dados incompletos ou inválidos", () => {
  it("entrada do pesquisador exige tema e nicho", () => {
    expect(ResearchInput.safeParse({ niche_id: "gta-vi" }).success).toBe(false);
    expect(ResearchInput.safeParse({ topic: "ok", niche_id: "" }).success).toBe(false);
    expect(ResearchInput.parse({ topic: "Tema válido", niche_id: "gta-vi" }).correction_notes).toEqual([]);
  });

  it("resultado do pesquisador rejeita URL inválida, alegação sem fonte e rótulo desconhecido", () => {
    expect(ResearchResult.safeParse(researchResult()).success).toBe(true);
    expect(ResearchResult.safeParse(researchResult({ sources: [{ url: "não é url", title: "x", publisher: null, published_at: null }] })).success).toBe(false);
    expect(ResearchResult.safeParse(researchResult({ claims_to_verify: [{ claim: "x", source_urls: [], initial_label: "rumor" }] })).success).toBe(false);
    expect(ResearchResult.safeParse(researchResult({ claims_to_verify: [{ claim: "x", source_urls: [SRC_A.url], initial_label: "certeza" }] })).success).toBe(false);
    const { unknowns: _u, ...semUnknowns } = researchResult();
    expect(ResearchResult.safeParse(semUnknowns).success).toBe(false);
  });

  it("resultado do verificador exige confiança válida", () => {
    expect(VerificationResult.safeParse(verificationResult()).success).toBe(true);
    const bad = verificationResult({ claims: [{ claim: "x", label: "rumor", confidence: "0.9", evidence_urls: [], notes: "" }] });
    expect(VerificationResult.safeParse(bad).success).toBe(false);
  });

  it("envelope padrão exige validação aprovada e próxima etapa conhecida", () => {
    const base = {
      task_id: "8c0b8f1e-6a8f-4c39-9d0a-1f0a2b3c4d5e",
      project_id: "8c0b8f1e-6a8f-4c39-9d0a-1f0a2b3c4d5f",
      run_id: "8c0b8f1e-6a8f-4c39-9d0a-1f0a2b3c4d60",
      agent_role: "pesquisador",
      agent_version: "pesquisador@1.0.0",
      status: "completed",
      result: {},
      evidence: [],
      limitations: [],
      unconfirmed: [],
      validation: { passed: true, warnings: [] },
      next_step: "verificador",
    };
    expect(AnyAgentOutputEnvelope.safeParse(base).success).toBe(true);
    expect(AnyAgentOutputEnvelope.safeParse({ ...base, validation: { passed: false, warnings: [] } }).success).toBe(false);
    expect(AnyAgentOutputEnvelope.safeParse({ ...base, next_step: "publicar" }).success).toBe(false);
  });
});

describe("validações de negócio", () => {
  it("pesquisador: aponta fonte não recuperada e alegação citando URL fora da lista", () => {
    const input = ResearchInput.parse({ topic: "Tema", niche_id: "gta-vi" });
    const result = ResearchResult.parse(
      researchResult({
        claims_to_verify: [{ claim: "x", source_urls: ["https://fora.example/a"], initial_label: "rumor" }],
      }),
    );
    const v = pesquisador.validate(input, result, [SRC_A]);
    expect(v.errors.some((e) => e.includes(SRC_B.url))).toBe(true);
    expect(v.errors.some((e) => e.includes("fora.example"))).toBe(true);
  });

  it("pesquisador: sem fontes e sem desconhecidos é erro; sem fontes com desconhecidos é aviso", () => {
    const input = ResearchInput.parse({ topic: "Tema", niche_id: "gta-vi" });
    const empty = ResearchResult.parse(researchResult({ sources: [], claims_to_verify: [], unknowns: [] }));
    expect(pesquisador.validate(input, empty, []).errors).toHaveLength(1);
    const explained = ResearchResult.parse(researchResult({ sources: [], claims_to_verify: [], unknowns: ["Nada publicado"] }));
    const v = pesquisador.validate(input, explained, []);
    expect(v.errors).toHaveLength(0);
    expect(v.warnings.length).toBeGreaterThan(0);
  });

  it("verificador: avisa alegações não verificadas e marca não confirmadas", () => {
    const research = ResearchResult.parse(researchResult());
    const input = verificador.inputSchema.parse({ topic: "T", niche_id: "gta-vi", research });
    const result = VerificationResult.parse(verificationResult({ claims: [verificationResult().claims[1]] }));
    const v = verificador.validate(input, result, []);
    expect(v.errors).toHaveLength(0);
    expect(v.warnings[0]).toContain("sem verificação");
    expect(v.unconfirmed[0]).toContain("rumor");
  });
});

describe("hash de entrada", () => {
  it("ignora notas de correção e ordem das chaves", () => {
    expect(inputHash({ a: 1, b: { c: 2, d: 3 } })).toBe(inputHash({ b: { d: 3, c: 2 }, a: 1, correction_notes: ["x"] }));
    expect(inputHash({ a: 1 })).not.toBe(inputHash({ a: 2 }));
  });
});
