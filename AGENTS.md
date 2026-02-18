# AGENTS.md

## Project Direction (EN/KR First)

This codebase is bilingual-first.
All user-facing features must be designed and implemented for both English and Korean from day one.

## 기본 설계 방향 (영어/한국어 다국어 우선)

이 코드베이스는 영어(`en`)와 한국어(`ko`)를 기본 지원 언어로 합니다.
신규 기능은 설계 단계부터 두 언어를 동시에 고려해야 하며, 단일 언어 기준으로 완성 처리하지 않습니다.

## Mandatory Rules

1. No hardcoded UI text in components.
2. Keep translation resources in a single i18n structure (for example: `src/i18n/en.json`, `src/i18n/ko.json`).
3. Every new text key must be added in both `en` and `ko` in the same change.
4. Default locale preference: `system` (system language first). Fallback locale: `en`. Supported locale switch: `system`, `en`, `ko`.
5. If a key is missing in one locale, fallback to `en` and log a warning in development.
6. Locale-sensitive values (date, time, number, currency) must use `Intl` APIs with active locale.
7. Layouts must tolerate text-length differences between English and Korean.
8. PRs are incomplete unless both language resources are updated and verified.

## PR Checklist (i18n)

- [ ] All new user-facing strings use i18n keys.
- [ ] `en` and `ko` translations were added together.
- [ ] Locale switch was tested for the changed screens.
- [ ] No truncation/overflow in either language.
