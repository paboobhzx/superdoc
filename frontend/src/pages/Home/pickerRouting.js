// frontend/src/pages/Home/pickerRouting.js
//
// One function per `kind` on the operation catalog. Each returns a promise
// that resolves to the navigation target (either a react-router path or an
// external URL for Stripe Checkout). Home.jsx calls the appropriate one
// based on the selected operation.
//
// Split out of Home.jsx so:
//   - the logic is testable without mounting the Home component;
//   - adding a new kind is one function addition and one switch branch;
//   - Home.jsx stays focused on UI rather than business routing.

import { api } from "../../lib/api"
import { extensionOf } from "./useConversionFlow"

// Maps an input extension to the editor route. Client-editor ops today are
// only doc_edit, which can apply to docx and xlsx. PDF and image editing
// could become client-editor ops in future iterations.
const EDITOR_ROUTES_BY_EXTENSION = {
  // Must match the routes in App.jsx. These use the /editor/<type> shape;
  // the previous /<type>-editor strings were a mismatch that sent users to
  // the wildcard fallback <Home /> instead of the actual editor page.
  docx: "/editor/docx",
  md: "/editor/markdown",
  markdown: "/editor/markdown",
  txt: "/editor/markdown",
  xlsx: "/editor/xlsx",
  pdf: "/editor/pdf",
  png: "/editor/image",
  jpg: "/editor/image",
  jpeg: "/editor/image",
  gif: "/editor/image",
  webp: "/editor/image",
}


/**
 * Handle a backend_job selection - the existing flow that was in Home.jsx.
 * Creates a job, uploads file via presigned POST, triggers processing,
 * returns the /processing/:id path.
 */
export async function handleBackendJob({ file, operation, params, auth, sessionId }) {
  const payload = {
    operation,
    file_size_bytes: file.size,
    file_name: file.name,
  }
  if (params && Object.keys(params).length > 0) {
    payload.params = params
  }
  let data
  if (auth && auth.isAuthenticated) {
    data = await api.createUserJob(payload)
  } else {
    data = await api.createJob({ ...payload, session_id: sessionId })
  }
  await api.uploadToS3(data.upload || data.upload_url, file)
  await api.triggerProcess(data.job_id)
  return { type: "internal", path: `/processing/${data.job_id}` }
}


/**
 * Handle a client_editor selection - upload the file, then redirect to the
 * correct editor page with ?key=<s3_key> so it can auto-load. Uses the
 * authenticated "store" flow if logged in, anonymous uploads otherwise.
 */
export async function handleClientEditor({ file, operation, editorRoute, auth, sessionId }) {
  const ext = extensionOf(file)
  const route = editorRoute || EDITOR_ROUTES_BY_EXTENSION[ext]
  if (!route) {
    throw new Error(`No editor for .${ext} files`)
  }

  // For authenticated users, use user_create_file which stores under users/*
  // and enforces the 10-file limit. Anonymous users go through the standard
  // job flow with a fake "store" operation that just saves without processing.
  let uploadKey = ""
  if (auth && auth.isAuthenticated) {
    const data = await api.createUserFile({
      file_name: file.name,
      file_size_bytes: file.size,
    })
    await api.uploadToS3(data.upload, file)
    await api.completeUserFile(data.job_id)
    uploadKey = data.output_key
  } else {
    // Anonymous upload: create a regular job with operation=<client editor> but
    // the dispatcher sees kind=client_editor and doesn\'t enqueue work.
    // The file ends up under uploads/<jobId>/<filename>.
    const data = await api.createJob({
      operation,
      file_size_bytes: file.size,
      file_name: file.name,
      session_id: sessionId,
    })
    await api.uploadToS3(data.upload || data.upload_url, file)
    uploadKey = data.file_key
  }

  const qs = `?key=${encodeURIComponent(uploadKey)}&name=${encodeURIComponent(file.name)}`
  return { type: "internal", path: `${route}${qs}` }
}


/**
 * Handle a paid_backend_job selection - redirect to Stripe Checkout.
 * Upload happens AFTER payment confirms (webhook creates the job and
 * signals the frontend via /processing/:id polling).
 *
 * NOTE: current implementation is a stub. No op has kind=paid_backend_job
 * yet, so this branch is defensive. When we flip an op to paid, we\'ll also
 * need to add a "return from Stripe" page (/paid?payment_id=...) that
 * uploads the file and kicks off processing.
 */
export async function handlePaidBackendJob({ file, operation, auth, sessionId }) {
  const origin = window.location.origin
  const payload = {
    operation,
    file_size_bytes: file.size,
    file_name: file.name,
    session_id: sessionId,
    // After payment, Stripe redirects here; we\'ll need a dedicated page to
    // finish the upload + processing handshake. Parking it at /processing
    // for now - the flow doesn\'t activate until we flip an op to paid.
    success_url: `${origin}/paid?status=ok`,
    cancel_url: `${origin}/?checkout=cancelled`,
  }
  const data = await api.createCheckout(payload)
  return { type: "external", url: data.checkout_url }
}


/**
 * Dispatcher - chooses handler based on the `kind` field on the picked
 * operation object. Unknown kinds default to backend_job for safety.
 */
export async function dispatchPick(opMeta, context) {
  const kind = opMeta && opMeta.kind ? opMeta.kind : "backend_job"
  if (kind === "client_editor") {
    return handleClientEditor({
      ...context,
      operation: opMeta.operation,
      editorRoute: opMeta.editor_route,
    })
  }
  if (kind === "paid_backend_job") {
    return handlePaidBackendJob({ ...context, operation: opMeta.operation })
  }
  return handleBackendJob({
    ...context,
    operation: opMeta.operation,
    params: opMeta.params,
  })
}
