import type { AgentConversation, AgentInputDraft, InputImage, TaskRecord } from '../types'
import { getPrivacySnapshotImageIds, type PrivacyModeState } from './privacyMode'

type ImageReferenceState = {
  tasks: TaskRecord[]
  inputImages: InputImage[]
  galleryInputDraft: AgentInputDraft | null
  agentInputDrafts: Record<string, AgentInputDraft>
  agentConversations: AgentConversation[]
  privacyMode: PrivacyModeState | null
}

export function addTaskReferencedImageIds(ids: Set<string>, task: TaskRecord) {
  for (const id of [
    ...task.inputImageIds,
    ...task.outputImages,
    ...task.transparentOriginalImages ?? [],
    ...task.streamPartialImageIds ?? [],
    task.maskTargetImageId,
    task.maskImageId,
    task.markupImageId,
  ]) {
    if (id) ids.add(id)
  }
}

// Named providers avoid store import cycles and are replaced safely during HMR.
// Callbacks read current metadata on every scan; a failed source aborts cleanup.
const externalSources = new Map<string, () => Iterable<string>>()
export function registerImageReferenceSource(name: string, source: () => Iterable<string>) {
  externalSources.set(name, source)
  return () => { if (externalSources.get(name) === source) externalSources.delete(name) }
}

export function structuredWorkbenchImageIds(session: {
  assets?: Array<{ id: string; imageId?: string }>
  productAssets?: Array<{ id: string; imageId?: string }>
  refs?: Array<{ asset: { id: string; imageId?: string } }>
  cards?: Array<{ resultImageId?: string | null }>
}): Set<string> {
  const ids = new Set<string>()
  for (const asset of [...session.assets ?? [], ...session.productAssets ?? [], ...(session.refs ?? []).map(ref => ref.asset)]) {
    if (asset.id) ids.add(asset.id)
    if (asset.imageId) ids.add(asset.imageId)
  }
  for (const card of session.cards ?? []) if (card.resultImageId) ids.add(card.resultImageId)
  return ids
}

export function getReferencedImageIds(state: ImageReferenceState) {
  const ids = new Set(getPrivacySnapshotImageIds(state.privacyMode))
  for (const task of state.tasks) addTaskReferencedImageIds(ids, task)
  const inputs = [state.inputImages, state.galleryInputDraft?.inputImages ?? [], ...Object.values(state.agentInputDrafts).map((draft) => draft.inputImages)]
  for (const images of inputs) {
    for (const img of images) {
      ids.add(img.id)
      if (img.markupImageId) ids.add(img.markupImageId)
    }
  }
  for (const conversation of state.agentConversations) {
    for (const item of [...conversation.rounds, ...conversation.messages]) {
      for (const id of item.inputImageIds ?? []) ids.add(id)
      if (item.maskTargetImageId) ids.add(item.maskTargetImageId)
      if (item.maskImageId) ids.add(item.maskImageId)
    }
  }
  for (const source of externalSources.values()) for (const id of source()) if (id) ids.add(id)
  return ids
}
