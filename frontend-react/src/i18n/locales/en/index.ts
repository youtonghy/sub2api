import adminAccessKeys from './adminAccessKeys'
import landing from './landing'
import common from './common'
import dashboard from './dashboard'
import channelMonitorV2 from './channelMonitorV2'
import batchImage from './batchImage'
import admin from './admin'
import misc from './misc'
import shell from './shell'
import authUi from './authUi'
import chartsUi from './chartsUi'
import opsUi from './opsUi'

export default {
  adminAccessKeys,
  ...landing,
  ...common,
  ...dashboard,
  ...channelMonitorV2,
  ...batchImage,
  admin,
  ...misc,
  ...shell,
  ...authUi,
  ...chartsUi,
  ...opsUi,
}
