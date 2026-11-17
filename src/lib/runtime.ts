// 运行时环境开关：8000 生产环境不展示“开放数据”（8021 staging / 本地开发仍保留）。
// 前后端同构构建、同一份 dist 同时供 8000/8021 使用，所以不能只在构建期裁剪。
export const HIDE_OPEN_DATA =
  typeof window !== 'undefined' && window.location.port === '8000';
