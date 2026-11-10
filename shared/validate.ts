/** Form rules shared by the browser (instant feedback) and the API (the check that counts). */
export interface Rule {
  required?: boolean;
  email?: boolean;
  url?: boolean;
  min?: number;
  max?: number;
  oneOf?: readonly string[];
}
export type Rules = Record<string, Rule>;
export type Errors = Record<string, string>;

export function validate(input: unknown, rules: Rules): { values: Record<string, string>; errors: Errors } {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const values: Record<string, string> = {};
  const errors: Errors = {};
  for (const [key, rule] of Object.entries(rules)) {
    const raw = src[key];
    const v = typeof raw === 'string' ? raw.trim() : '';
    values[key] = v;
    if (!v) { if (rule.required) errors[key] = 'This field is required.'; continue; }
    if (rule.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) errors[key] = 'Enter an email like name@example.com.';
    else if (rule.url && !/^https?:\/\/\S+\.\S+/.test(v)) errors[key] = 'Enter a full link starting with https://';
    else if (rule.min && v.length < rule.min) errors[key] = `Use at least ${rule.min} characters.`;
    else if (rule.max && v.length > rule.max) errors[key] = `Keep this under ${rule.max} characters.`;
    else if (rule.oneOf && !rule.oneOf.includes(v)) errors[key] = 'Choose one of the listed options.';
  }
  return { values, errors };
}
export const hasErrors = (e: Errors) => Object.keys(e).length > 0;

export const PLAN_IDS = ['starter', 'growth', 'studio'] as const;
export const TOPICS = ['Support', 'Team plan', 'Feature', 'Other'] as const;
export const DEVICES = ['iPhone', 'Android'] as const;

export const hookRules: Rules = { text: { required: true, min: 3, max: 300 } };
export const scriptRules: Rules = { text: { required: true, min: 20, max: 6000 } };
export const contactRules: Rules = {
  name: { required: true, max: 120 },
  email: { required: true, email: true, max: 200 },
  topic: { required: true, oneOf: TOPICS },
  message: { required: true, min: 10, max: 2000 },
};
export const waitlistRules: Rules = { email: { required: true, email: true, max: 200 }, device: { required: true, oneOf: DEVICES } };
export const affiliateRules: Rules = {
  name: { required: true, max: 120 },
  email: { required: true, email: true, max: 200 },
  channel: { required: true, url: true, max: 300 },
};
export const checkoutRules: Rules = {
  plan: { required: true, oneOf: PLAN_IDS },
  name: { required: true, max: 120 },
  email: { required: true, email: true, max: 200 },
};

export const signupRules: Rules = {
  email: { required: true, email: true, max: 200 },
  password: { required: true, min: 10, max: 200 },
  name: { max: 80 },
};
export const loginRules: Rules = {
  email: { required: true, email: true, max: 200 },
  password: { required: true, max: 200 },
};
