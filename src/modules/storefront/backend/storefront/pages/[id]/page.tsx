import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { PageSettingsForm } from '../../../../components/pages/PageForm'

export default function StorefrontPageSettingsPage({ params }: { params?: { id?: string } }) {
  const id = params?.id
  if (!id) return null
  return (
    <Page>
      <PageBody>
        <PageSettingsForm id={id} />
      </PageBody>
    </Page>
  )
}
