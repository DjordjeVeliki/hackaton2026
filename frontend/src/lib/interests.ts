/** Built-in interest suggestions for the profile combobox (shown after topics found in the CV). */
export const SUGGESTED_INTERESTS = [
  'Machine Learning',
  'Deep Learning',
  'Large Language Models',
  'Generative AI',
  'Computer Vision',
  'Natural Language Processing',
  'MLOps',
  'Data Engineering',
  'Data Science',
  'Data Visualization',
  'Vector Databases',
  'Cloud Computing',
  'Kubernetes',
  'DevOps',
  'Serverless',
  'Distributed Systems',
  'Microservices',
  'Backend Development',
  'Frontend Development',
  'Mobile Development',
  'Web Performance',
  'API Design',
  'Cybersecurity',
  'Zero Trust',
  'Privacy & Compliance',
  'Blockchain',
  'Internet of Things',
  'Robotics',
  'Product Management',
  'UX Design',
] as const

/** CV/question topics first, then built-in suggestions; case-insensitive dedupe, minus already chosen ones. */
export function interestOptions(fromProfile: string[], chosen: string[]): string[] {
  const seen = new Set(chosen.map((c) => c.toLowerCase()))
  const out: string[] = []
  for (const t of [...fromProfile, ...SUGGESTED_INTERESTS]) {
    const k = t.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(t)
  }
  return out
}
