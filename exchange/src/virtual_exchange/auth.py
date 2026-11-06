"""Public exchange authentication interface placeholder; not implemented.

The callable stub will authenticate credentials and return an account identity and
permissions, or an authentication failure. Credential format and identity
lifecycle remain undecided. This boundary owns no trading balances or scoring.

Future API callers pass authenticated identity to the exchange. Website
integration consumes the published API rather than importing this module.
"""

from collections.abc import Mapping


def authenticate(*, credentials: Mapping[str, str]) -> Mapping[str, object]:
    """Return identity/permissions or fail authentication; not implemented.

    Credential fields and result schema are provisional. No credential is checked
    and no identity is created until the authentication slice is implemented.
    """
    raise NotImplementedError("authenticate is not implemented")
