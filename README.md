# NebulaCut

Electron + React + Tailwind 기반 로컬 비디오 편집기 기본 프로젝트입니다.

## 포함 기능
- 비디오 / 이미지 / 오디오 파일 가져오기
- 비디오 트랙, 오디오 트랙 분리 편집
- 이미지 클립을 비디오 트랙에 배치
- 타임라인 재생, 이동, 트림(앞/뒤), 분할, 삭제
- 클립 인스펙터(시작/길이/오프셋/볼륨)

## 실행
```bash
npm install
npm run dev
```

`npm run dev`는 Vite와 Electron을 동시에 실행합니다.

## 빌드
```bash
npm run build
npm run start
```

`npm run build`는 렌더러 번들을 생성하고, `npm run start`는 Electron으로 앱을 실행합니다.
