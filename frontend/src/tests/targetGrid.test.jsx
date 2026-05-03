import { describe, it, expect } from "vitest"
import { buildTargetGridChoices, TARGET_GRID } from "../pages/Home/targetGrid"

describe("target grid", () => {
  it("includes the full visual target set", () => {
    expect(TARGET_GRID.map((item) => item.target)).toEqual([
      "pdf",
      "docx",
      "png",
      "jpg",
      "webp",
      "gif",
      "tiff",
      "md",
      "html",
      "xlsx",
      "csv",
      "txt",
    ])
  })

  it("uses conversion-specific descriptions when available", () => {
    const choices = buildTargetGridChoices("pdf", [
      {
        operation: "pdf_to_image",
        kind: "backend_job",
        intent: "convert",
        label: "PDF to images",
        targets: ["png", "jpg"],
        params_schema: { target_format: { required: true, enum: ["png", "jpg"] } },
      },
      {
        operation: "xlsx_to_csv",
        kind: "backend_job",
        intent: "convert",
        label: "Excel to CSV",
        targets: ["csv"],
      },
    ])

    expect(choices.find((choice) => choice.target === "png")?.description).toBe("ZIP per page")
    expect(choices.find((choice) => choice.target === "csv")?.description).toBe("First sheet")
  })

  it("explains disabled slots instead of using one generic message", () => {
    const choices = buildTargetGridChoices("jpg", [
      {
        operation: "image_convert",
        kind: "backend_job",
        intent: "convert",
        label: "Convert image",
        targets: ["png", "jpg", "webp"],
        params_schema: { target_format: { required: true, enum: ["png", "jpg", "webp"] } },
      },
    ])

    expect(choices.find((choice) => choice.target === "jpg")?.disabledReason).toBe("Same format")
    expect(choices.find((choice) => choice.target === "png")?.enabled).toBe(true)
  })
})
