// One error convention for every controller.
//   fail(res, status, message)   send an error response right now (status first, message second)
//   httpError(status, message)   build an Error carrying a status, to `throw` from helpers that have no `res`
//   wrap(fn)                     async-handler wrapper: turns a thrown httpError into fail(), anything else into next(e)

const fail = (res, status, message) => res.status(status).json({ message });

const httpError = (status, message) => Object.assign(new Error(message), { status });

// `label` names the operation in the server log if a response dies after it has started streaming.
const wrap = (fn, label = 'response failed after headers were sent') => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (e) {
    // A download that already started cannot be turned into a JSON error: log it and abort the connection so the
    // client sees a truncated file instead of a "successful" corrupt one.
    if (res.headersSent) {
      console.error(`[${label}]`, e);
      return res.destroy(e);
    }
    if (e.status) return fail(res, e.status, e.message);
    next(e);
  }
};

module.exports = { fail, httpError, wrap };
