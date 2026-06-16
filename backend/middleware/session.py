import uuid

from starlette.middleware.base import BaseHTTPMiddleware

SESSION_COOKIE = "compas_session"
COOKIE_MAX_AGE = 60 * 60 * 24 * 30


class SessionMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        session_id = request.cookies.get(SESSION_COOKIE) or str(uuid.uuid4())
        request.state.session_id = session_id

        response = await call_next(request)

        if not request.cookies.get(SESSION_COOKIE):
            response.set_cookie(
                SESSION_COOKIE,
                session_id,
                httponly=False,
                samesite="lax",
                max_age=COOKIE_MAX_AGE,
            )
        return response
