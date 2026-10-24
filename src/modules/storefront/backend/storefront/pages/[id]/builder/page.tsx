import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { PageBuilder } from '../../../../../components/builder/PageBuilder'

export default function StorefrontPageBuilderPage({ params }: { params?: { id?: string } }) {
  const id = params?.id
  if (!id) return null
  return (
    <Page>
      <PageBody>
        <PageBuilder pageId={id} />
      </PageBody>
    </Page>
  )
}
