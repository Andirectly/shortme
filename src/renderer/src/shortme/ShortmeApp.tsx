import { useEffect } from 'react'
import { ToolsScreen } from './ToolsScreen'
import { ReviewScreen } from './ReviewScreen'
import { Shell } from './Shell'
import { useStore } from './store'
import { useEngines } from './engines'
import { useProject } from './projectStore'
import { StartScreen } from './StartScreen'
import { ProcessingScreen, ClipsScreen, ProjectsScreen } from './ClipScreens'
import { EditorScreen } from './EditorScreen'
import { SettingsScreen } from './OtherScreens'
import { StudioScreen } from './StudioScreen'
import { TestlabScreen } from './TestlabScreen'
import { LiveScreen } from './LiveScreen'
import { CompareScreen } from './CompareScreen'
import { UploadScreen } from './UploadScreen'
import { WorkbenchScreen } from './WorkbenchScreen'
import { LearnScreen } from './LearnScreen'
import { ModelsScreen, SetupWizard } from './ModelsScreen'
import { PersonsDialog } from './PersonsDialog'
import { PatchNotesAfterUpdate } from './PatchNotes'
import './tokens.css'

export default function ShortmeApp(): React.JSX.Element {
  const screen = useStore((s) => s.screen)
  const init = useEngines((s) => s.init)
  useEffect(() => { void init(); useProject.getState().init() }, [init])
  return (
    <Shell>
      {screen === 'start' && <StartScreen />}
      {screen === 'projects' && <ProjectsScreen />}
      {screen === 'processing' && <ProcessingScreen />}
      {screen === 'clips' && <ClipsScreen />}
      {screen === 'editor' && <EditorScreen />}
      {screen === 'studio' && <StudioScreen />}
      {screen === 'models' && <ModelsScreen />}
      {screen === 'testlab' && <TestlabScreen />}
      {screen === 'live' && <LiveScreen />}
      {screen === 'upload' && <UploadScreen />}
      {screen === 'workbench' && <WorkbenchScreen />}
      {screen === 'learn' && <LearnScreen />}
      {screen === 'compare' && <CompareScreen />}
      {screen === 'review' && <ReviewScreen />}
      {screen === 'tools' && <ToolsScreen />}
      {screen === 'settings' && <SettingsScreen />}
      <SetupWizard />
      <PatchNotesAfterUpdate />
      <PersonsDialog />
    </Shell>
  )
}
