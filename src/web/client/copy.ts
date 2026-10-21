/**
 * The plugin's own copy, in the two languages the harness ships.
 *
 * PdfCraft owns its own chrome, appearance and language; this text appears
 * only where the Panel itself must speak: the waiting and missing states, the
 * Standalone Mode notice, a refused read, and the Revision Guard's
 * reload/overwrite refusal.
 */

/** One locale's key-to-template map. */
export type Dictionary = Readonly<Record<string, string>>

/** The English dictionary. */
export const EN: Dictionary = {
  'page.title': 'PdfCraft',
  'page.description': 'Open PdfCraft in the right sidebar.',
  'checking': 'Preparing PdfCraft…',
  'missing.title': 'PdfCraft web build not found',
  'missing.body':
    'Fetch {file} from the PdfCraft {release} release, extract it, then set the plugin\'s webBuildDir to the extracted folder.',
  'missing.directory': 'Currently configured:',
  'missing.retry': 'Check again',
  'standalone.notice': 'Standalone Mode — saves download and do not reach the workspace.',
  'error.title': 'Could not open this document',
  'error.binding': 'The harness did not report which document this conversation is bound to.',
  'error.network': 'The harness did not answer. Check the connection and try again.',
  'error.load': 'Could not read the document from the workspace.',
  'error.notFound': 'That document is no longer in the workspace.',
  'error.outside': 'That path is outside this conversation\'s workspace.',
  'error.tooLarge': 'This document is over the configured limit of {limit} bytes (maxDocumentBytes).',
  'error.notLoaded': 'Open this document in the Panel before saving it.',
  'error.noWorkspace': 'This conversation has no workspace to save into.',
  'error.retry': 'Try again',
  'error.dismiss': 'Dismiss',
  'conflict.title': 'This document changed on disk',
  'conflict.body':
    'It changed after the Panel loaded it. Reload to show the current file, or overwrite it with what is in the Panel.',
  'conflict.reload': 'Reload',
  'conflict.overwrite': 'Overwrite anyway',
}

/** The Chinese dictionary. */
export const ZH: Dictionary = {
  'page.title': 'PdfCraft',
  'page.description': '在右侧边栏打开 PdfCraft。',
  'checking': '正在准备 PdfCraft…',
  'missing.title': '未找到 PdfCraft 网页版构建',
  'missing.body': '请从 PdfCraft {release} 发布页下载 {file}，解压后把插件的 webBuildDir 指向解压出的文件夹。',
  'missing.directory': '当前配置：',
  'missing.retry': '重新检查',
  'standalone.notice': '独立模式 — 保存的文件会下载，不会写回工作区。',
  'error.title': '无法打开此文档',
  'error.binding': 'Harness 未告知此对话绑定的文档。',
  'error.network': 'Harness 没有响应。请检查连接后重试。',
  'error.load': '无法从工作区读取该文档。',
  'error.notFound': '该文档已不在工作区中。',
  'error.outside': '该路径在此对话的工作区之外。',
  'error.tooLarge': '此文档超过了配置的上限 {limit} 字节（maxDocumentBytes）。',
  'error.notLoaded': '请先在 Panel 中打开此文档再保存。',
  'error.noWorkspace': '此对话没有可写入的工作区。',
  'error.retry': '重试',
  'error.dismiss': '关闭',
  'conflict.title': '此文档已在磁盘上更改',
  'conflict.body': '文档在 Panel 载入后发生了更改。选择重新载入以查看当前文件，或用 Panel 中的内容覆盖它。',
  'conflict.reload': '重新载入',
  'conflict.overwrite': '仍然覆盖',
}

/** Both dictionaries, as the locale service registers them. */
export const DICTIONARIES = { en: EN, zh: ZH }
