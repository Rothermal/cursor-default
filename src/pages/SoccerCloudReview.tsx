import { Navigate, useLocation } from 'react-router-dom'
import { legacySoccerReviewSummaryPath } from '../lib/soccer/summary'

export default function SoccerCloudReview() {
  const location = useLocation()
  return (
    <Navigate
      to={legacySoccerReviewSummaryPath(location.search)}
      replace
    />
  )
}
