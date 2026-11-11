/**
 * React 版新增的界面文案。与 Vue 版共享的语言文件保持原样，便于同步上游增量。
 */
export default {
  shell: {
    forkVersion: {
      builtAt: '打包于 {time}',
      upstreamBase: '基于上游',
      upstreamLatest: '最新上游',
      upToDate: '已基于最新上游版本',
      behind: '上游有新版本 {version}',
      syncHint: '合并上游代码并重新构建即可同步，本程序不支持在线更新。',
      viewChangelog: '查看更新日志',
      viewDiff: '查看上游改动',
      checkFailed: '无法获取上游最新版本',
    },
    expandSidebar: '展开侧边栏',
    collapseSidebar: '收起侧边栏',
    openNavigation: '打开导航',
    closeNavigation: '关闭导航',
    navigation: '导航',
    errorTitle: '页面出错了',
    errorDescription: '页面加载失败，请刷新重试。',
    theme: '主题',
    themeSystem: '跟随系统',
    dateRange: {
      noDates: '未选择日期',
      dayCount: '{n} 天',
      presets: '快捷范围',
      previousMonth: '上个月',
      nextMonth: '下个月',
      pickEndDate: '请选择结束日期',
    },
    notFound: {
      description: '你访问的页面不存在或已被移动。',
      goBack: '返回上一页',
      goToDashboard: '前往仪表盘',
      needHelp: '需要帮助？',
      contactSupport: '联系客服',
    },
    reload: '刷新',
  },
}
