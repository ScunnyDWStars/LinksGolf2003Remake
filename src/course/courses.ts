import { CEDAR_RIDGE } from './cedarRidge';
import { KESTREL_DUNES } from './kestrelDunes';
import type { CourseSpec } from './types';

export const COURSES: readonly CourseSpec[] = [CEDAR_RIDGE, KESTREL_DUNES];

export function getCourse(id: string): CourseSpec {
  return COURSES.find((c) => c.id === id) ?? COURSES[0];
}
