import { QueryClient } from '@tanstack/react-query';

/**
 * 全局 QueryClient——服务端状态的唯一缓存层。
 *
 * 默认值取向（S0 协作指南 §6 的地基）：
 *  - staleTime 15s：15 秒内的重复挂载直接用缓存（切 tab 不闪加载态）
 *  - retry: 1：网络抖动自动重试一次，失败再暴露给 UI
 *  - refetchOnWindowFocus 关闭：内网工具，避免切回浏览器页面的突发请求
 *  - 各查询用 queryKey 细分（如 ['pipeline', pid, wf]），失效走 invalidate
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
