import type {
  FieldPolicy,
  RuleMatcher,
  TemplateField,
  ValidationIssue,
  WindowLineConfig,
  WindowPricingData,
  WindowProduct,
  WindowTemplate,
} from "./types";
import { evalCondition } from "./conditions";

// Validation pass for one window line. Pure: template + product + L3 data in, issues out.
// Order matters — later checks assume earlier ones passed (e.g. size constraints read
// selections that field validation has already vetted). The server ALWAYS re-validates;
// the configurator runs the same function client-side for inline feedback.

/** Effective config = template defaults ← policy defaults ← user selections (offered fields only). */
export function effectiveSelections(
  template: WindowTemplate,
  product: WindowProduct,
  selections: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of template.fields) {
    const policy = product.fieldPolicies[field.key];
    if (policy && !policy.isOffered) continue; // not offered → field absent from config space
    out[field.key] = policyDefault(policy) ?? field.defaultValue;
  }
  for (const [k, v] of Object.entries(selections)) {
    if (k in out) out[k] = v; // unknown keys handled as issues in validate, not silently merged
  }
  return out;
}

function policyDefault(policy: FieldPolicy | undefined): unknown {
  if (!policy) return undefined;
  switch (policy.controlKind) {
    case "image":
      return policy.defaultPattern ?? undefined;
    default:
      return (policy as { defaultValue?: unknown }).defaultValue;
  }
}

export function matcherMatches(
  matcher: RuleMatcher,
  selections: Record<string, unknown>
): boolean {
  const v = selections[matcher.fieldKey];
  if (matcher.truthy !== undefined) return Boolean(v) === matcher.truthy;
  if (matcher.anyOf) return matcher.anyOf.includes(String(v));
  if (matcher.valueToken !== undefined) return String(v) === matcher.valueToken;
  return v !== undefined && v !== null && v !== "" && v !== false;
}

export function validateWindowConfig(args: {
  template: WindowTemplate;
  product: WindowProduct;
  config: WindowLineConfig;
  pricing: WindowPricingData;
}): { issues: ValidationIssue[]; effective: Record<string, unknown> } {
  const { template, product, config, pricing } = args;
  const issues: ValidationIssue[] = [];
  const effective = effectiveSelections(template, product, config.selections);
  const byKey = new Map<string, TemplateField>(template.fields.map((f) => [f.key, f]));

  // -- unknown selection keys (client bug or stale template) --------------------------------
  for (const k of Object.keys(config.selections)) {
    if (!byKey.has(k)) {
      issues.push({ fieldKey: k, code: "UNKNOWN_FIELD", message: `Unknown field "${k}"` });
    }
  }

  // -- per-field: offered + allowed + typed ---------------------------------------------------
  for (const field of template.fields) {
    const policy = product.fieldPolicies[field.key];
    const offered = !policy || policy.isOffered;
    const visible = evalCondition(field.visibleWhen, effective);
    const provided = field.key in config.selections;
    const value = effective[field.key];

    if (provided && !offered) {
      issues.push({
        fieldKey: field.key,
        code: "NOT_OFFERED",
        message: `${field.label} is not offered on ${product.name}`,
      });
      continue;
    }
    if (!offered || !visible) continue; // hidden fields keep defaults; nothing to validate

    switch (field.control.kind) {
      case "select": {
        const allowed =
          policy && policy.controlKind === "select"
            ? policy.allowedValues
            : field.control.options.map((o) => o.value);
        if (value === undefined || value === null || value === "") {
          if (field.required !== false) {
            issues.push({
              fieldKey: field.key,
              code: "MISSING_REQUIRED",
              message: `${field.label} is required`,
            });
          }
        } else if (!allowed.some((a) => a === value)) {
          issues.push({
            fieldKey: field.key,
            code: "VALUE_NOT_ALLOWED",
            message: `${field.label}: "${String(value)}" is not available`,
          });
        }
        break;
      }
      case "color": {
        if (policy && policy.controlKind === "color") {
          if (!policy.allowedColors.some((c) => c.value === value)) {
            issues.push({
              fieldKey: field.key,
              code: "VALUE_NOT_ALLOWED",
              message: `${field.label}: color is not available`,
            });
          }
        }
        break;
      }
      case "image": {
        if (policy && policy.controlKind === "image" && value != null) {
          if (!policy.allowedPatterns.some((p) => p.patternAssetId === value)) {
            issues.push({
              fieldKey: field.key,
              code: "VALUE_NOT_ALLOWED",
              message: `${field.label}: pattern is not available`,
            });
          }
        }
        break;
      }
      case "slider": {
        const range =
          policy && policy.controlKind === "slider"
            ? policy.range
            : { min: field.control.min, max: field.control.max, step: field.control.step };
        const n = Number(value);
        if (Number.isNaN(n) || n < range.min || n > range.max) {
          issues.push({
            fieldKey: field.key,
            code: "OUT_OF_RANGE",
            message: `${field.label} must be between ${range.min} and ${range.max}`,
          });
        }
        break;
      }
      case "toggle": {
        if (provided && typeof config.selections[field.key] !== "boolean") {
          issues.push({
            fieldKey: field.key,
            code: "VALUE_NOT_ALLOWED",
            message: `${field.label} must be on or off`,
          });
        }
        break;
      }
      case "text":
        break;
    }
  }

  // -- dimensions ----------------------------------------------------------------------------
  const dims: Record<string, number> = { width: config.widthIn, height: config.heightIn };
  for (const d of template.dimensions) {
    const v = dims[d.key];
    if (typeof v !== "number" || Number.isNaN(v)) {
      issues.push({
        code: "DIMENSION_OUT_OF_RANGE",
        message: `${d.label} is required`,
      });
    } else if (v < d.min || v > d.max) {
      issues.push({
        code: "DIMENSION_OUT_OF_RANGE",
        message: `${d.label} must be between ${d.min}″ and ${d.max}″`,
      });
    }
  }

  // -- size constraints (the customer's SIZE LIMITATION tuples) -------------------------------
  const areaSqft = (config.widthIn * config.heightIn) / 144;
  for (const c of pricing.sizeConstraints) {
    if (c.productId != null && c.productId !== product.id) continue;
    if (!matcherMatches(c.matcher, effective)) continue;
    const v = c.dimension === "width" ? config.widthIn : c.dimension === "height" ? config.heightIn : areaSqft;
    const unit = c.dimension === "area_sqft" ? " sqft" : "″";
    if (c.minValue != null && v < c.minValue) {
      issues.push({
        fieldKey: c.matcher.fieldKey,
        code: "SIZE_CONSTRAINT",
        message: c.message ?? `Minimum ${c.dimension.replace("_", " ")} for this option is ${c.minValue}${unit}`,
      });
    }
    if (c.maxValue != null && v > c.maxValue) {
      issues.push({
        fieldKey: c.matcher.fieldKey,
        code: "SIZE_CONSTRAINT",
        message: c.message ?? `Maximum ${c.dimension.replace("_", " ")} for this option is ${c.maxValue}${unit}`,
      });
    }
  }

  return { issues, effective };
}
